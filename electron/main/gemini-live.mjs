/**
 * electron/main/gemini-live.mjs
 *
 * The Gemini Live session lifecycle: connect/reconnect, building the live
 * config (system prompt + tool declarations + audio config), routing
 * tool-calls to the dispatcher, and forwarding mic/camera frames up while
 * streaming transcripts + audio back down to the renderer.
 */
import { buildVideoInput, stripDataUrl } from "./live-input.mjs";
import { emitToRenderer, emitEvent } from "./events.mjs";
import { mainWindow, updateTrayMenu } from "./window-manager.mjs";
import { buildClaudeTools } from "./claude-tools-catalog.mjs";
import { executeClaudeTool } from "./tool-dispatcher.mjs";
import { canvasCapability, secondBrainCapability } from "./capabilities.mjs";
import { startCompanionServer } from "../companion-server.mjs";
import { pendingClaudeAnnouncements } from "./notify-iris.mjs";
import { userDisplayName, workspaceContextLine } from "./session-store.mjs";
import { MODEL_CHOICES } from "./agent-roster.mjs";
import { submitClaudeTask, sendWebMessage } from "./claude-runner.mjs";
import { getRobotsConfig } from "./device-config.mjs";
import { stopAllVisionLoops } from "./vision.mjs";
import { getNextGeminiKey, getGenAiClient, markKeyRateLimited, isRateLimitError } from "./gemini-keys.mjs";

export let liveSession = null;

function flushPendingAnnouncements() {
  while (pendingClaudeAnnouncements.length > 0 && liveSession) {
    try {
      liveSession.sendRealtimeInput({ text: pendingClaudeAnnouncements.shift() });
    } catch (e) {
      console.error("[IRIS] flush announcement failed:", e.message);
      break;
    }
  }
}
export let ai = null;
export let liveStatus = { running: false, pid: null };
let userTranscriptBuffer = "";
let modelTranscriptBuffer = "";
// Gemini Live closes each WebSocket connection after ~10 minutes. With
// sessionResumption enabled the server hands us refresh handles; on close we
// reconnect with the latest handle so the conversation continues seamlessly
// instead of dropping Iris back to the "Press W to wake" sleep screen.
let resumptionHandle = null;
let userStopped = false;

let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 5;

export function getLiveGeminiStatus() {
  if (liveSession) return "connected";
  if (reconnectTimer) return "connecting";
  return liveStatus?.running ? "connecting" : "offline";
}

let hasGreetedStartup = false;

export const GreetGate = {
  done: false,
  timer: null,
  arm() {
    this.done = false;
    if (this.timer) clearTimeout(this.timer);
    // Chào một câu ngắn gọn, ấm áp sau 1.2s khi vừa kết nối phiên lúc khởi động
    this.timer = setTimeout(() => this.fire(), 1200);
  },
  fire() {
    if (this.done) return;
    this.done = true;
    hasGreetedStartup = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    sendWelcomeGreeting();
  },
};

function flushTranscripts() {
  if (userTranscriptBuffer.trim()) {
    emitEvent({ type: "transcript", speaker: "you", text: userTranscriptBuffer.trim() });
  }
  if (modelTranscriptBuffer.trim()) {
    emitEvent({ type: "transcript", speaker: "gemini", text: modelTranscriptBuffer.trim() });
    sendWebMessage(`[Gemini🎙️]: ${modelTranscriptBuffer.trim()}`);
  }
  userTranscriptBuffer = "";
  modelTranscriptBuffer = "";
}

/**
 * Quy tắc dùng toàn bộ công cụ trong /tools (OS/Desktop/Phần cứng) cho Gemini Live.
 * Ngắn gọn, súc tích, chỉ rõ mục đích để Gemini gọi trực tiếp không qua Claude.
 */
const LOCAL_TOOL_RULES = [
  "LOCAL OS/HARDWARE TOOLS (/tools): ALWAYS call these tools directly for any desktop, window, system, terminal, filesystem, or hardware request — NEVER delegate to Claude via submit_claude_task.",
  "1. APPS & WINDOWS: open_url_or_app{target, is_url} or universal_app_launcher{action: launch|search|list, query} (launches ANY installed Windows app, Start Menu shortcut, Registry App Path, or UWP/Store app); close_app{target}; minimize_app{target} (hide app to taskbar); hide_app{target} (fully invisible); restore_app{target}; window_manager{action: list|focus|maximize|minimize|restore|close|snap|pin, target?, position?, pinned?} (manage windows: list all open windows, bring to front/focus, maximize, snap left/right/top/bottom/top-left/top-right/bottom-left/bottom-right/center, or pin Always-On-Top); move_window_precise{name, x, y, width?, height?} (resize/shrink/move window); move_window_magic{mode, x, y}; desktop_manager{action: new|close|left|right|boss} ('boss' = Win+D hide all windows / show desktop); process_manager{action: list|kill, name?}; write_note{text, is_new?}.",
  "2. MOUSE, CLICKING & VISION: computer_use_omniparser{task} (PRIMARY CLICK TOOL: ALWAYS call this tool whenever the user asks to click, press, tap, or select ANY button, icon, link, search box, or UI element on screen by name or description — it uses local OmniParser to detect exact pixel coordinates; NEVER GUESS x/y coordinates yourself!); mouse_control{action: move|click|drag|scroll|position|release, x?, y?, button?} (ONLY for explicit numeric coordinates e.g. 'toạ độ 500 300', scrolling, or dragging; NEVER guess coordinates to click visual elements); take_ai_screenshot{save?} (inspect PC screen); take_camera_snapshot{target?, save?} (capture photo of a specific target: 'screen'/'desktop' for PC screen, 'companion'/'alt c'/'phone' for phone camera, 'robot 1'/'esp32_robot_1' for robot, or smart home camera name); toggle_screen_vision (continuous PC screen stream); toggle_camera_stream_vision (continuous phone camera stream); toggle_robot_vision{robot_id} (continuous robot stream); toggle_smarthome_vision{camera_id} (continuous smart home stream); open_companion_live_view (open large live video window for user to watch phone camera); ocr_region{left?, top?, width?, height?}; color_picker{x?, y?}; active_window_info; view_image{action: latest|prev|next|close}; multi_monitor_info.",
  "3. SYSTEM, NETWORK, SERVICES & PACKAGES: system_control{volume: up|down|mute|unmute, volume_level: 0-100, brightness: 0-100, wifi: on|off, bluetooth: on|off, camera: on|off}; wifi_manager{action: list|profiles|status|connect|disconnect, ssid?}; power_manager{action: sleep|shutdown|restart}; media_control{action: playpause|next|prev}; get_system_stats (CPU/RAM/disk/battery); system_ops{action: network_info|ports|ping|services|winget|clean_temp|empty_recycle_bin|env, target?, sub_action?} (deep system diagnostics, active TCP ports, ping host, Windows services list/start/stop/restart, winget search/list/install/upgrade/uninstall, clean temp files, empty recycle bin); run_terminal_command{command, shell?: powershell|cmd|python, cwd?, timeout?} (execute any PowerShell, CMD, or Python one-liner directly on the PC); idle_time; focus_assist; lock_screen.",
  "4. CLIPBOARD, FILESYSTEM & ALERTS: filesystem_ops{action: list|read|write|append|mkdir|copy|move|rename|delete|info|zip|unzip, path, dest?, content?, pattern?} (complete file & folder management: list directory, read/write/append text files, create folder, copy/move/rename/delete files or folders, zip/unzip archives); file_explorer{path, action?, select?} (open folder or file visually in Windows File Explorer); read_clipboard; write_clipboard{text} (ONLY when user explicitly asks to copy/sao chép); clipboard_history{action: list|use|clear|start|stop}; search_local_files{query, max?} (fast search via Everything); read_system_notifications{limit?, reveal_otp?}; send_desktop_notification{title, message}; quick_reminder{action: schedule|list|cancel, minutes?, title?, message?}.",
  "5. VIETNAMESE COMMANDS & AMBIGUITY DISAMBIGUATION: Xem quy tắc chi tiết ở mục IMPORTANT VIETNAMESE UI MAPPING bên dưới cho 'thu nhỏ'/'ẩn'/'phóng to' (Iris vs app ngoài). BẤM / CLICK VÀO PHẦN TỬ MÀN HÌNH: khi người dùng bảo 'click vào...', 'bấm vào...', 'chọn nút...', 'nhấp vào icon...', 'bấm vào ô tìm kiếm...' (ví dụ: 'click vào nút Play', 'bấm vào icon Chrome', 'bấm vào ô tìm kiếm', 'click vào video đầu tiên') -> ALWAYS invoke computer_use_omniparser{task: '...'} để OmniParser tự động chụp ảnh màn hình và phát hiện toạ độ nút chuẩn xác 100%. TUYỆT ĐỐI KHÔNG tự ước lượng/đoán mò tọa độ x, y từ mắt thường hay screen vision rồi gọi mouse_control; 'mở ứng dụng bất kỳ' (Zalo, Photoshop, Premiere, Word, Excel, CapCut, OBS, Steam...) -> open_url_or_app hoặc universal_app_launcher; 'chia đôi màn hình / ghim cửa sổ lên trên cùng / đưa cửa sổ sang trái-phải / danh sách cửa sổ đang mở' -> window_manager; 'tạo file / đọc file / sửa file / tạo thư mục / sao chép file / di chuyển file / đổi tên file / xóa file / nén zip / giải nén' -> filesystem_ops; 'chạy lệnh PowerShell / CMD / kiểm tra git / chạy lệnh terminal' -> run_terminal_command; 'kiểm tra mạng / IP / cổng port đang mở / ping / dịch vụ Windows services / cài phần mềm bằng winget / dọn rác temp / dọn thùng rác' -> system_ops; 'đóng ứng dụng' / 'tắt app' -> close_app; mở thư mục/file/ổ đĩa/Downloads/Desktop trong File Explorer -> file_explorer; âm lượng/độ sáng -> system_control; nghe/dừng nhạc -> media_control; tình trạng pin/RAM/CPU -> get_system_stats; tìm file -> search_local_files; đọc clipboard -> read_clipboard; sao chép vào clipboard (khi có từ 'copy' / 'sao chép') -> write_clipboard; tắt máy/ngủ -> power_manager; gõ chữ / viết chữ / ghi chữ / nhập chữ / gõ phím / type (vd 'ghi hello world', 'gõ hello world', 'viết hello world') -> ALWAYS invoke computer_use_type{text: '...'} to type directly onto the screen (NEVER call write_clipboard); ghi chú / note / lưu ghi chú -> write_note{text, is_new?} (mở Notepad lưu lại); XÓA DÒNG / SỬA DÒNG / XÓA CHỮ: 'xóa dòng này' / 'xóa dòng hiện tại' -> computer_use_type{action: 'delete_line'}; 'xóa dòng trên' / 'lên 1 dòng xóa' -> computer_use_type{line_offset: -1, action: 'delete_line'}; 'xóa dòng dưới' -> computer_use_type{line_offset: 1, action: 'delete_line'}; 'xóa dòng N' / 'xóa dòng thứ N' -> computer_use_type{line_number: N, action: 'delete_line'}; 'sửa dòng N thành ...' / 'viết lại dòng N thành ...' -> computer_use_type{line_number: N, action: 'clear_line', text: '...'}; 'xóa N từ' -> computer_use_type{action: 'delete_word', repeat: N}; 'xóa N chữ' -> computer_use_type{key: 'backspace', repeat: N}; TUYỆT ĐỐI KHÔNG DÙNG ctrl+a xóa sạch tài liệu khi người dùng chỉ yêu cầu sửa hoặc xóa một dòng hay vài từ; DI CHUYỂN CỬA SỔ / DI CHUYỂN TAB: 'di chuyển cửa sổ' / 'di chuyển tab' (đến vị trí toạ độ x, y) -> move_window_precise{name: 'active', x, y} hoặc move_window_magic{mode: 'active', x, y}. Di chuyển TRỰC TIẾP VÀ NGAY LẬP TỨC cửa sổ đang mở trên cùng, TUYỆT ĐỐI KHÔNG bắt người dùng bấm chọn vào cửa sổ đó và không đếm ngược; CHUYỂN ĐỔI TAB TRÌNH DUYỆT: 'chuyển tab' / 'sang tab tiếp theo' / 'đổi tab' -> computer_use_type{key: 'ctrl+tab'}; 'lùi tab' -> computer_use_type{key: 'ctrl+shift+tab'}; 'đóng tab' -> computer_use_type{key: 'ctrl+w'}; 'mở tab mới' -> computer_use_type{key: 'ctrl+t'}; TRÌNH DIỄN / GIỚI THIỆU CHỨC NĂNG: 'giới thiệu những thứ bạn có thể làm' / 'demo tính năng' / 'trình diễn khả năng' / 'bạn làm được những gì' / 'showcase' -> ALWAYS invoke iris_showcase{}. QUY TẮC BẮT BUỘC: Khi gọi iris_showcase, Iris TUYỆT ĐỐI KHÔNG tự nói trước hoặc trong khi gọi tool (vì công cụ iris_showcase sẽ trực tiếp thuyết minh qua từng bước, nói trước sẽ gây đè giọng và lặp tiếng). TUYỆT ĐỐI KHÔNG gọi lại iris_showcase khi nó đang chạy. Sau khi tool hoàn tất, chỉ cần nói 1 câu ngắn: 'Tôi đã hoàn thành toàn bộ màn trình diễn cho bạn xem rồi nhé!'.",
  "6. VISION ROUTING & ANTI-HALLUCINATION: NEVER hallucinate or guess visual contents before receiving an image frame. QUY TẮC MÀN HÌNH BẮT BUỘC: Khi người dùng nhắc đến 'màn hình' (screen, nhìn màn hình, xem màn hình, trên màn hình có gì...), BẮT BUỘC PHẢI gọi take_ai_screenshot{} để chụp ảnh màn hình mới nhất ngay tại thời điểm đó và xem màn hình vừa chụp để trả lời; TUYỆT ĐỐI KHÔNG được lấy ảnh chụp lần trước hay suy đoán từ trí nhớ cũ. If asked 'Bạn có thấy không?', 'Nhìn vào màn hình', or 'Đang có gì?' without an active feed, immediately execute the vision tool: (a) 'xem/nhìn/chụp màn hình' -> take_ai_screenshot (or toggle_screen_vision if asked to turn on vision); (b) 'xem/nhìn/chụp camera điện thoại/Alt+C/companion' -> take_camera_snapshot{target: 'companion'} (or toggle_camera_stream_vision, open_companion_live_view); (c) 'xem/nhìn/chụp camera robot (robot 1, robot 2...)' -> take_camera_snapshot{target: 'robot 1'} (or toggle_robot_vision{robot_id: '...'}); (d) 'xem/nhìn/chụp camera nhà/phòng khách' -> take_camera_snapshot{target: '...'} (or toggle_smarthome_vision{camera_id: '...'}). CRITICAL VISION RESPONSE STYLE: When describing the screen or camera, answer CONCISELY and ACCURATELY in 1–2 short sentences focusing ONLY on the main window/activity actually visible in the frame just received. NEVER ramble, NEVER list every desktop shortcut icon, and NEVER repeat or guess from earlier conversation history or Notepad showcase text. If a tool reports an error (e.g. camera offline), truthfully report the error — DO NOT invent visual details.",
  "8. TOOL EXECUTION INTEGRITY & ANTI-HALLUCINATION (TUYỆT ĐỐI CHỐNG NÓI TRƯỚC / BÁO HOÀN THÀNH KHỐNG): Khi người dùng yêu cầu chạy lệnh terminal, mở app, tạo/đọc file, kiểm tra mạng hay chỉnh cửa sổ, PHẢI gọi tool tương ứng TRƯỚC TIÊN. TUYỆT ĐỐI KHÔNG nói 'Đã xong', 'Đã hoàn thành', 'Đã mở', 'Đã chạy' trước hoặc trong khi phát toolCall. TUYỆT ĐỐI KHÔNG tự bịa ra kết quả khi chưa gọi tool. Chỉ nói kết quả SAU KHI nhận được toolResponse từ hệ thống: nếu thành công thì tóm tắt kết quả thực tế; nếu lỗi hoặc thiếu quyền thì báo rõ lỗi. Với submit_claude_task hoặc start_computer_use_task trả về status 'started', chỉ nói 'Tôi đang bắt đầu thực hiện trong nền...', TUYỆT ĐỐI KHÔNG nói 'Đã hoàn thành'."
].join("\n");

function buildLiveConfig(resumeHandle) {
  const isClaudeEnabled = process.env.IRIS_CLAUDE_ENABLED !== "false";
  return {
    responseModalities: ["AUDIO"],
    mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: process.env.GEMINI_LIVE_VOICE || "Zephyr",
        },
      },
    },
    // Empty object still opts in to receiving resumption handles.
    sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
    contextWindowCompression: {
      triggerTokens: 104857,
      slidingWindow: { targetTokens: 52428 },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [
      // Google Search grounding is a BILLED feature. On a free-tier Gemini key the
      // Live API closes the session immediately with a 1011 "exceeded your current
      // quota" error the moment this tool is present. Enable only with billing on:
      //   IRIS_ENABLE_GOOGLE_SEARCH=true
      ...(process.env.IRIS_ENABLE_GOOGLE_SEARCH === "true" ? [{ googleSearch: {} }] : []),
      ...buildClaudeTools(),
    ],
    systemInstruction: {
      parts: [
        {
          text: [
            `You are Iris, the realtime voice front-end for ${userDisplayName()}.`,
            "CRITICAL ETIQUETTE & DISCRETION PROTOCOL (QUY TẮC IM LẶNG & TRỢ LÝ CHUYÊN NGHIỆP):",
            "- DO NOT INTERRUPT THIRD-PARTY CONVERSATIONS: When the user is talking with friends, colleagues, family, in a meeting, or on a phone call in the room, STAY COMPLETELY SILENT. NEVER comment, interrupt, chime in, or reply to their conversation. ONLY respond when the user speaks DIRECTLY to you (e.g. addressing you by name 'Iris', 'này Iris', or issuing a clear instruction directed to the assistant). When in doubt whether the user is talking to someone else or to you: ALWAYS DEFAULT TO SILENCE.",
            "- RESPECT SILENCE & NEVER ASK UNSOLICITED QUESTIONS: When the user is silent, working, thinking, reading, typing, or when there is ambient background noise: REMAIN ABSOLUTELY SILENT. NEVER speak unprompted asking 'Are you there?', 'Do you need help?', 'Bạn có đó không?', 'Bạn đang nghĩ gì thế?'. You are an executive, discreet assistant: always 100% attentive and ready when called, but NEVER noisy or intrusive.",
            "Claude is your worker brain for multi-step coding, deep research, deals and background automation. You also have built-in Google Search — use it directly for quick facts and simple lookups that don't need Claude.",
            `CRITICAL: be decisive, never ask clarifying questions for actionable work. Any request to research, code, check, build, or find a deal -> immediately submit_claude_task. Only exception: a NEW project/feature goes through PO intake (see PRODUCT OWNER CONTROL below).`,
            "Routing: quick fact -> Google Search. Multi-step/background work -> Claude. Anything covered by a lane below -> call that lane directly, never through Claude, and never make the user wait behind a busy Claude session for it.",
            "LANES (use directly instead of submit_claude_task when they fit): (1) BROWSER — browser_open/browser_click/browser_type/browser_scroll/browser_navigate/browser_press_key/browser_get_links/browser_extract_text/browser_screenshot for on-page actions; fall back to start_computer_use_task only for whole-screen or non-browser work. (2) COMPUTER USE — start_computer_use_task returns an action id immediately; get_action_status/get_iris_status for progress, stop_action to cancel. (3) SMART HOME — trigger_smart_home for a one-off command; create_smarthome_rule for a standing automation (build the trigger/condition/action fields yourself from what the user said); manage existing ones with list_smarthome_rules/delete_smarthome_rule/set_smarthome_rule_enabled. (4) STATUS — get_iris_status answers 'what are you doing / what's running'. (5) APPS, WINDOWS, FILESYSTEM, TERMINAL & SYSTEM — open_url_or_app, universal_app_launcher, window_manager, filesystem_ops, run_terminal_command, system_ops, close_app, hide_app, minimize_app, restore_app, write_note, move_window_magic, move_window_precise, computer_use_type (see LOCAL OS/HARDWARE TOOLS below for exact syntax).",
            LOCAL_TOOL_RULES,
            `ROBOT CAMERAS: user's robots are ${Object.values(getRobotsConfig()).map((r, i) => `${i + 1} (${r.name || "Robot " + (i + 1)})`).join(", ")}. To view or snapshot a robot camera, use take_camera_snapshot{target: 'robot <number>'} or toggle_robot_vision{robot_id: '<id>'}.`,
            "SILENT MODE: set_silent_mode(enabled: true) on 'quiet/whisper/mute' requests ('im lặng thôi', 'đừng nói to') — keep listening and replying as text, just not aloud. set_silent_mode(enabled: false) to resume speaking.",
            "Sessions are user-controlled: each role (PO/DEV/plain) keeps its own continuous, auto-resuming conversation, reset only by an explicit new-session request or a different project folder. Follow-ups may reference the role's earlier work. One task runs at a time; new ones queue. Never invent a session id or folder — if the user wants a different project, tell them to pick it from the UI.",
            workspaceContextLine(),
            "Call get_workspace_info (never guess) when asked which project/session/role is active. On SYSTEM_EVENT_WORKSPACE_UPDATE, update silently, don't speak. On SYSTEM_EVENT_AGENT_SELECT (role switched from UI), follow its instructions_to_iris; switching to PO with no ongoing conversation always opens by asking how the project started (own idea / mandate / customer request).",
            "Agent pipeline (OpenSpec-based): PO grills the request then proposes a change under openspec/changes/<name>/tasks.md (decides WHAT); DEV implements the open change's tasks test-first, verifies, archives it (decides HOW). User picks the role from the UI; only pass 'agent' when they explicitly name one. PO is a live session that can pause mid-task to ask you something (SYSTEM_EVENT_PO_QUESTION); DEV is headless, never pauses, and needs a PO-proposed change to run against.",
            "STUDY role (separate, for learning not building): the user reads a source and synthesizes aloud to you — you answer their questions yourself, and only hand the worker a brief to RECORD a note (synthesis + source) or VERIFY one (claims + source) when explicitly asked. May pause with SYSTEM_EVENT_PO_QUESTION (asking_role: Study). No OpenSpec. Only route here when STUDY is active or explicitly requested.",
            "PRODUCT OWNER CONTROL: you are the PO's voice, not its analyst — never interview the user or write a PRD yourself. On a NEW project/feature, send submit_claude_task (role PO) a short control intent, e.g. 'Start a new feature: <verbatim details>. Grill me to pin down requirements.' Relay its SYSTEM_EVENT_PO_QUESTION prompts aloud and answer via answer_po_question. When the user's satisfied, send 'You have enough — propose the change.' To check progress: 'Are there tasks left?'. Skip all this for ordinary tasks.",
            "DECISIONS RELAY: when a Claude result includes a 'Decisions needed'/'Open Questions' section, read each one aloud with its options and recommendation, let the user pick, then submit_claude_task to the SAME role restating each decision and the chosen option. Postponed decisions keep their recommended default.",
            `MODEL CONTROL: set_agent_model(role, model) only on an explicit request to switch a role's model — never on your own. Models: ${MODEL_CHOICES.map((choice) => `${choice.label} (${choice.id})`).join(", ")}.`,
            "PO LIVE QUESTIONS (mid-task, distinct from Decisions Relay): on SYSTEM_EVENT_PO_QUESTION, read the questions/options aloud immediately — the run is paused, not finished. Answer every one via answer_po_question (exact question text + chosen label) once you have them; suggest the first option if asked, but submit what the user actually picked.",
            "BRIEF WRITING — the 'task' string is all headless Claude gets, so nothing left unwritten survives: PO gets a short control intent (never a PRD/tasks/acceptance-criteria — that's its job). DEV gets 'implement the open change' (+ its name if given, + any spoken override the spec can't know about). STUDY gets an explicit RECORD or VERIFY brief with the synthesis/claims and source verbatim. A Decisions-needed follow-up restates each decision + chosen option verbatim, never reopening settled ones. Self-check before sending: could someone who never heard this conversation do the work from the brief alone?",
            "UI control: toggle teleprompter/copilot/meeting-recorder/cameras via control_ui's matching toggle_* action. 'open it/that result', 'show history', 'close it', 'go back', 'open the current task' -> get_ui_context + control_ui, never submit_claude_task. 'show/hide the steps' -> show_task_steps/hide_task_steps, target named in query if given, else the viewed or running task.",
            "Task-by-description: 'open the failed one'/'open the deals task' -> control_ui action open_task_by_query with those words as query, no exact match needed. If Iris shows a chooser for multiple matches, user can click or say first/second/third — check pendingTaskMatches via get_ui_context first. Ambiguous UI command -> prefer expanded task, then focused task, then latest result. Keep acknowledgements short.",
            `SLEEP: on 'go to sleep'/'goodnight'/'that's all for now'/'ngủ đi'/'tạm nghỉ', a short goodbye then go_to_sleep — only when explicitly asked. A pending PO question always gets answered before an ambiguous new open-task request.`,
            `After submit_claude_task: 'started' means the task has ONLY JUST BEGUN in background — NEVER say 'Completed' or 'Đã hoàn thành'! Say one short line ("Tôi đang bắt đầu chạy ngầm cho bạn" / "Claude's on it now"); 'queued' -> tell ${userDisplayName()} it's queued behind the current task. Keep what you SAY short even when what you SENT was detailed.`,
            `start_new_claude_session only on an explicit request (new/fresh session, start over); confirm briefly afterward.`,
            `On SYSTEM_EVENT_SESSION_START, greet ${userDisplayName()} in English once: "Hi ${userDisplayName()}, welcome back. Iris is online and all channels are connected, so we're good to go. What do you have in mind?", then listen quietly.`,
            `On SYSTEM_EVENT_CLAUDE_COMPLETE, proactively announce it (even mid-chat), briefly: Claude's back, summarize, ask if they want the details before continuing.`,
            "Answer directly only for greetings, quick chat, or status questions.",
            "Keep voice responses natural and short.",
            "IMPORTANT VIETNAMESE UI MAPPING: DO NOT confuse 'thu nhỏ' (making window size smaller / PiP, still visible on screen) with 'ẩn' (hiding/minimizing to taskbar or boss key). (1) 'Ẩn màn hình', 'về desktop', 'hiện desktop' = desktop_manager{action: 'boss'}. (2) 'Thu nhỏ' Iris ('thu nhỏ', 'thu nhỏ Iris', 'cho Iris nhỏ lại') = shrink Iris to Picture-in-Picture -> control_ui toggle_robot_pip; 'Thu nhỏ' an external app ('thu nhỏ cửa sổ Chrome/Notepad', 'cho nhỏ lại') = move_window_precise with smaller width/height (window stays visible on screen); NEVER call minimize_app, hide_app, or minimize_iris when the user asks to 'thu nhỏ'. (3) 'Ẩn tab', 'ẩn đi', 'giấu đi', 'dấu trừ' = for Iris itself: control_ui minimize_iris (drops Iris to the taskbar); for another app: minimize_app with that app's exe (or hide_app if fully hidden). (4) 'Phóng to', 'mở rộng', 'mở lại', 'hiện lại' = control_ui restore_iris if Iris is on the taskbar, or toggle_robot_pip again if Iris is in Picture-in-Picture; for another app: restore_app with that app's exe. minimize_app/hide_app/close_app/restore_app cannot act on Iris's own window. NEVER confuse these.",
            canvasCapability.promptFragment(),
            secondBrainCapability.promptFragment(),
            !isClaudeEnabled
              ? "CRITICAL: Claude is currently DISABLED in Settings. Do NOT use submit_claude_task. Try to complete the user's request using your other available tools directly (browser, system apps, smarthome, etc.). If a task is too complex or requires Claude, apologize and remind the user to enable Claude in Settings."
              : "",
          ].filter(Boolean).join("\n"),
        },
      ],
    },
  };
}

function sendWelcomeGreeting() {
  if (!liveSession) return;

  const greeting =
    `SYSTEM_EVENT_SESSION_START: The app just started up. Greet ${userDisplayName()} in ENGLISH right now, saying: ` +
    `"Hi ${userDisplayName()}, welcome back. Iris is online and all channels are connected, so we're good to go. What do you have in mind?" ` +
    `CRITICAL: Speak this English greeting ONCE right now. After this greeting, stay quietly attentive and do NOT repeat it or ask unsolicited questions.`;

  liveSession.sendRealtimeInput({ text: greeting });
}

export async function startLive() {
  if (liveSession) return liveStatus;
  userStopped = false;
  resumptionHandle = null;
  reconnectAttempts = 0;
  hasGreetedStartup = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    await connectLive({ isReconnect: false });
  } catch (err) {
    console.error("[GEMINI_LIVE_ERROR]", err);
    emitEvent({ type: "fatal", message: err.message || String(err) });
    throw err;
  }
  // BUG-COMP-04/COMP-02 FIX: Pass sendFrameToGemini so companion video frames
  // go directly to Gemini Live without an unnecessary renderer round-trip.
  startCompanionServer(emitEvent, sendAudioChunk, mainWindow, sendFrameToGemini);
  return { running: true, pid: process.pid, geminiStatus: "connected" };
}

async function connectLive({ isReconnect }) {
  const apiKey = getNextGeminiKey({ purpose: "live" });
  if (!apiKey) {
    emitEvent({ type: "fatal", message: "GEMINI_API_KEY is not set." });
    throw new Error("GEMINI_API_KEY is not set");
  }

  const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
  ai = getGenAiClient(apiKey);
  liveStatus = { running: true, pid: process.pid, geminiStatus: "connecting" };
  emitEvent({ type: "sidecar_status", status: { running: true, model, mode: "webrtc-aec", geminiStatus: "connecting" } });
  emitEvent({ type: "gemini_status", status: "connecting", model });

  try {
    liveSession = await ai.live.connect({
      model,
      config: buildLiveConfig(resumptionHandle),
      callbacks: {
        onopen() {
          reconnectAttempts = 0;
          liveStatus = { running: true, pid: process.pid, geminiStatus: "connected" };
          emitEvent({ type: "sidecar_status", status: { running: true, pid: process.pid, model, mode: "webrtc-aec", geminiStatus: "connected" } });
          emitEvent({ type: "gemini_status", status: "connected", model });
          emitEvent({ type: "audio_state", state: "listening" });
          updateTrayMenu();
          // G-02: onopen có thể chạy TRƯỚC khi `liveSession` được gán (gán sau `await connect`), khi đó
          // hàng đợi không xả được — nên xả cả ở đây lẫn ngay sau khi connect() trả về.
          flushPendingAnnouncements();
          // The resumed session keeps its context; greeting again mid-conversation
          // every ~10 minutes would be jarring.
          if (!isReconnect) GreetGate.arm();
        },
        onmessage(message) {
          handleLiveMessage(message);
        },
        onerror(error) {
          if (isRateLimitError(error)) {
            markKeyRateLimited(apiKey);
            resumptionHandle = null;
          }
          emitEvent({ type: "fatal", message: "Gemini Live error", error: error?.message || String(error) });
        },
        onclose(event) {
          console.error("[IRIS][close] code=", event?.code, "reason=", event?.reason || "(none)");
          const isRateLimit = isRateLimitError(event?.reason) || event?.code === 1011;
          if (isRateLimit) {
            markKeyRateLimited(apiKey);
            resumptionHandle = null;
          }
          flushTranscripts();
          liveSession = null;
          if (userStopped) {
            liveStatus = { running: false, pid: null, geminiStatus: "offline" };
            emitEvent({ type: "gemini_status", status: "offline" });
            emitEvent({ type: "audio_state", state: "idle" });
            emitEvent({ type: "sidecar_status", status: liveStatus, reason: event?.reason || "closed" });
            updateTrayMenu();
            return;
          }
          liveStatus = { running: true, pid: process.pid, geminiStatus: "connecting" };
          scheduleReconnect(event?.reason || "connection closed", { isRateLimit });
        },
      },
    });
  } catch (err) {
    if (isRateLimitError(err)) {
      markKeyRateLimited(apiKey);
      resumptionHandle = null;
      const nextKey = getNextGeminiKey({ purpose: "live" });
      if (nextKey && nextKey !== apiKey) {
        console.warn(`[IRIS] Live connect chạm giới hạn quota, tự động chuyển sang key tiếp theo...`);
        return connectLive({ isReconnect });
      }
    }
    throw err;
  }
  // G-02: phiên đã được gán — xả các thông báo đã xếp hàng lúc offline/reconnect.
  flushPendingAnnouncements();
}

function scheduleReconnect(reason, { isRateLimit = false } = {}) {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    liveStatus = { running: false, pid: null, geminiStatus: "offline" };
    emitEvent({
      type: "fatal",
      message: `Gemini Live reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts.`,
      error: reason,
    });
    emitEvent({ type: "gemini_status", status: "offline" });
    emitEvent({ type: "audio_state", state: "idle" });
    emitEvent({ type: "sidecar_status", status: liveStatus, reason });
    return;
  }
  // Repeated failures suggest a stale resumption handle — drop it and let the
  // remaining attempts open a fresh session (context lost, but Iris stays up).
  if (reconnectAttempts >= 3) resumptionHandle = null;
  // Khi chạm 429/1011 và chuyển sang Standby Key: tái kết nối cực nhanh (<0.3s)
  const delay = isRateLimit ? 150 : Math.min(500 * 2 ** (reconnectAttempts - 1), 8000);
  console.log(`[IRIS][reconnect] attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms (${reason})`);
  emitEvent({ type: "gemini_status", status: "connecting" });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectLive({ isReconnect: true }).catch((error) => {
      liveSession = null;
      const isNextRateLimit = isRateLimitError(error);
      scheduleReconnect(error?.message || String(error), { isRateLimit: isNextRateLimit });
    });
  }, delay);
}

let pendingToolCalls = 0;

async function handleToolCall(toolCall) {
  const calls = toolCall.functionCalls || [];
  pendingToolCalls += calls.length || 1;
  const functionResponses = [];
  const executedShowcase = new Set();
  try {
    for (const call of calls) {
      // Khử trùng lặp gọi lặp iris_showcase trong cùng một lượt
      if (call.name === "iris_showcase") {
        if (executedShowcase.has("iris_showcase")) {
          functionResponses.push({
            id: call.id,
            name: call.name,
            response: { result: { status: "busy", message: "Đang chạy màn trình diễn, bỏ qua lệnh trùng lặp." } },
          });
          continue;
        }
        executedShowcase.add("iris_showcase");
      }

      emitEvent({ type: "tool_call", name: call.name, args: call.args || {} });
      try {
        const result = await executeClaudeTool(call.name, call.args || {});
        functionResponses.push({ id: call.id, name: call.name, response: { result } });
      } catch (error) {
        functionResponses.push({
          id: call.id,
          name: call.name,
          response: { status: "error", error: error.message },
        });
      }
    }
    if (functionResponses.length && liveSession) {
      liveSession.sendToolResponse({ functionResponses });
    }
  } finally {
    pendingToolCalls = Math.max(0, pendingToolCalls - (calls.length || 1));
  }
}

function handleLiveMessage(message) {
  if (message.sessionResumptionUpdate) {
    const { resumable, newHandle } = message.sessionResumptionUpdate;
    if (resumable && newHandle) resumptionHandle = newHandle;
  }

  if (message.goAway) {
    // G-03: GIỮ resumptionHandle. Đã đối chiếu tài liệu Live API hiện hành (ai.google.dev/gemini-api/docs/live-session,
    // 03/10/2026): kết nối sống tối đa ~10 phút; token resumption còn hiệu lực 2 GIỜ sau khi phiên kết thúc và
    // phải được dùng để nối lại không mất ngữ cảnh. Trước đây xoá handle ở đây khiến mỗi ~10 phút Iris quên
    // toàn bộ cuộc trò chuyện. Handle chỉ bị bỏ khi nối lại bằng handle thất bại nhiều lần
    // (reconnectAttempts >= 3 trong scheduleReconnect) — đó mới là trường hợp token hỏng/hết hạn.
    console.log("[IRIS][goAway] timeLeft=", message.goAway.timeLeft || "(unknown)");
    if (liveSession) {
      try { liveSession.close(); } catch { /* ignore */ }
    }
  }

  if (message.toolCall) {
    handleToolCall(message.toolCall).catch((error) => {
      emitEvent({ type: "fatal", message: "Tool call failed", error: error.message });
    });
  }

  const content = message.serverContent;
  if (!content) return;

  if (content.interrupted) {
    flushTranscripts();
    emitToRenderer("live:interrupt", {});
    emitEvent({ type: "audio_state", state: "listening" });
    return;
  }

  if (content.inputTranscription?.text) userTranscriptBuffer += content.inputTranscription.text;
  if (content.outputTranscription?.text) modelTranscriptBuffer += content.outputTranscription.text;

  for (const part of content.modelTurn?.parts || []) {
    if (part.text) modelTranscriptBuffer += part.text;
    const inlineData = part.inlineData;
    if (!inlineData?.data) continue;
    const mimeType = inlineData.mimeType || "audio/pcm;rate=24000";
    if (!mimeType.startsWith("audio/")) continue;
    // Chống báo hoàn thành ảo / nói trước khi tool thực thi:
    // Nếu trong packet có toolCall hoặc đang có tool gọi dở dang chưa trả toolResponse (pendingToolCalls > 0),
    // mọi audio chunk được sinh ra trong lượt này là lời thoại võ đoán trước khi tool chạy xong.
    // Bỏ qua audio này để chờ lượt kế tiếp (sau sendToolResponse) khi Gemini đã có kết quả thực tế.
    if (message.toolCall || pendingToolCalls > 0) continue;
    emitToRenderer("live:audio", { data: inlineData.data, mimeType });
    emitEvent({ type: "audio_state", state: "speaking" });
  }

  if (content.turnComplete) {
    flushTranscripts();
    emitEvent({ type: "audio_state", state: pendingToolCalls > 0 ? "thinking" : "listening" });
  }
}

export async function stopLive() {
  userStopped = true;
  resumptionHandle = null;
  reconnectAttempts = 0;
  pendingToolCalls = 0;
  hasGreetedStartup = false;
  setAudioChunkSuppressed(false);
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Stop the vision loops before closing the session so the intervals never
  // try to send frames on a dead WebSocket.
  stopAllVisionLoops();
  if (liveSession) {
    try { liveSession.close(); } catch { /* ignore close races */ }
  }
  liveSession = null;
  liveStatus = { running: false, pid: null, geminiStatus: "offline" };
  emitToRenderer("live:interrupt", {});
  emitEvent({ type: "gemini_status", status: "offline" });
  emitEvent({ type: "audio_state", state: "idle" });
  emitEvent({ type: "sidecar_status", status: liveStatus });
  updateTrayMenu();
  return liveStatus;
}


let _nutJs = null;
export async function getNutJs() {
  if (!_nutJs) _nutJs = await import("@nut-tree-fork/nut-js");
  return _nutJs;
}

// V-01: gửi 1 khung hình lên Gemini Live. Trả true CHỈ KHI đã thực sự đưa vào session
// (để tool vision không báo "success" khi không có gì được gửi).
let warnedNoFrameSession = false;
export function sendVideoFrame(base64, mimeType) {
  if (!liveSession) {
    if (!warnedNoFrameSession) {
      warnedNoFrameSession = true;
      emitEvent({ type: "log", level: "warn", message: "[vision] chưa có phiên Gemini Live — khung hình bị bỏ qua." });
    }
    return false;
  }
  warnedNoFrameSession = false;
  const input = buildVideoInput(stripDataUrl(base64), mimeType);
  if (!input) return false;
  try {
    liveSession.sendRealtimeInput(input);
    return true;
  } catch (e) {
    console.error("[IRIS][vision] sendRealtimeInput failed:", e.message);
    return false;
  }
}
// Alias giữ tương thích với import cũ (companion-server, local-tools...).
export const sendFrameToGemini = sendVideoFrame;

let audioChunkSuppressed = false;

export function setAudioChunkSuppressed(suppressed) {
  audioChunkSuppressed = Boolean(suppressed);
  console.log(`[IRIS] audioChunkSuppressed = ${audioChunkSuppressed}`);
}

export function sendAudioChunk(arrayBuffer) {
  if (audioChunkSuppressed) return;
  if (!liveSession || !arrayBuffer) return;
  const buffer = Buffer.from(new Uint8Array(arrayBuffer));
  if (!buffer.byteLength) return;
  liveSession.sendRealtimeInput({
    audio: { data: buffer.toString("base64"), mimeType: "audio/pcm;rate=16000" },
  });
}

export function sendCommand(command) {
  if (command?.type === "text" && command.text) {
    if (!liveSession) throw new Error("Gemini Live is not running");
    liveSession.sendRealtimeInput({ text: command.text });
  }
  if (command?.type === "submit_claude_task" && command.task) {
    submitClaudeTask({ task: command.task, agent: command.agent }).catch((error) => {
      emitEvent({ type: "claude_task_update", status: "error", task: command.task, error: error.message });
    });
  }
}
