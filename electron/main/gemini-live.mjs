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
  "LOCAL OS/HARDWARE TOOLS: Always invoke these directly for OS/Desktop actions — NEVER delegate to Claude via submit_claude_task.",
  // 1. CLICK & MOUSE (MẶC ĐỊNH OMNIPARSER)
  "1. CLICK & MOUSE (MẶC ĐỊNH OMNIPARSER): ALWAYS invoke computer_use_omniparser{task: '...'} whenever user says 'click', 'bấm', 'nhấp', 'chọn vào', 'tap' on ANY app, icon, button, search box, or visual screen element (e.g. 'click vào một app bất kì', 'click vào Chrome', 'bấm icon Zalo', 'click nút Play'). User NEVER needs to say 'omni' — any visual click request defaults 100% to computer_use_omniparser. OmniParser tự động chụp ảnh màn hình mới nhất, xác định tọa độ và click — TUYỆT ĐỐI KHÔNG tự đoán toạ độ. EXCEPTIONS: (a) If clicking an element inside Iris's automated browser tab -> browser_click; (b) If answering a task chooser or PO question (e.g. 'chọn cái thứ nhất') -> control_ui or answer_po_question; (c) Explicit numeric coordinates ('toạ độ 500 300') or scrolling/dragging -> mouse_control; (d) Fast Windows native controls by name (when requested) -> ui_automation. NEVER call open_url_or_app when user asks to 'click' or 'bấm vào icon'!",
  // 2. VISION & SCREEN (CHỐNG DÙNG ẢNH CŨ & HỖ TRỢ ALT+S)
  "2. VISION & SCREEN (CHỐNG DÙNG ẢNH CŨ): (a) If an image frame was JUST received in the message context (via Alt+S Vision Snap Mode or continuous vision stream), answer directly from that frame — DO NOT call take_ai_screenshot{} again. (b) If NO image frame was attached in current turn and user asks to inspect visual screen contents ('xem/nhìn màn hình', 'trên màn hình có gì') -> take_ai_screenshot{}. NEVER guess from stale images or past memory. DO NOT call take_ai_screenshot for non-visual commands like 'độ sáng màn hình' (system_control), 'ẩn màn hình' (desktop_manager), or 'chia đôi màn hình' (window_manager). (c) 'camera điện thoại/Alt+C/companion/phone' -> take_camera_snapshot{target: 'companion'}. (d) 'camera robot' -> take_camera_snapshot{target: 'robot 1'}. (e) 'camera nhà' -> take_camera_snapshot{target: '<cam_id>'}. Answer concisely in 1-2 sentences focusing only on the main visible activity.",
  // 3. APPS & WINDOWS (QUY TẮC CỐT LÕI: \"THU NHỎ\" ≠ \"ẨN\")
  "3. APPS & WINDOWS (QUY TẮC PHÂN BIỆT THU NHỎ VS ẨN BẮT BUỘC): (a) 'THU NHỎ' / 'THU NHỎ MÀN HÌNH' / 'CHO NHỎ LẠI' = LUÔN LÀ THU NHỎ KÍCH THƯỚC (CỬA SỔ VẪN NỔI TRÊN MÀN HÌNH, TUYỆT ĐỐI KHÔNG ẨN XUỐNG TASKBAR): Khi nói về Iris cụ thể -> control_ui{action: 'toggle_robot_pip'}; Khi KHÔNG nêu tên hoặc nói về app ngoài (Chrome, Notepad...) -> MẶC ĐỊNH là app ngoài đang active: move_window_precise{name: 'active', width: 960, height: 600, x: 100, y: 100}. TUYỆT ĐỐI KHÔNG gọi minimize_app khi người dùng nói 'thu nhỏ'. (b) 'ẨN' / 'GIẤU ĐI' / 'HẠ XUỐNG TASKBAR' / 'DẤU TRỪ': Về Iris -> control_ui{action: 'minimize_iris'}; App ngoài -> minimize_app{target: 'active'}; 'ẩn màn hình / về desktop' -> desktop_manager{action: 'boss'}. (c) 'PHÓNG TO' / 'MỞ LẠI': Iris -> control_ui{action: 'restore_iris'}; App ngoài -> window_manager{action: 'maximize'}. (d) 'MỞ/BẬT/CHẠY APP' (không có chữ click) -> MẶC ĐỊNH open_url_or_app{target, is_url}; universal_app_launcher{command: 'search'|'list'} dùng khi cần tìm kiếm/liệt kê danh sách app; 'đóng/tắt app' -> close_app{target}; 'chia đôi/snap' -> window_manager{action: 'snap', position}; 'di chuyển cửa sổ/tab' -> move_window_precise{name: 'active', x, y} hoặc move_window_magic{mode: 'active', x, y}.",
  // 4. TYPING, EDITING & CLIPBOARD
  "4. TYPING & EDIT: 'gõ/nhập/viết chữ ...' -> computer_use_type{text: '...'} (type directly to screen; NEVER call write_clipboard); 'xóa dòng này/hiện tại' -> computer_use_type{action: 'delete_line'}; 'xóa dòng trên' -> computer_use_type{line_offset: -1, action: 'delete_line'}; 'xóa dòng dưới' -> computer_use_type{line_offset: 1, action: 'delete_line'}; 'xóa dòng N/thứ N' -> computer_use_type{line_number: N, action: 'delete_line'}; 'sửa dòng N thành ...' -> computer_use_type{line_number: N, action: 'clear_line', text}; 'xóa N từ' -> computer_use_type{action: 'delete_word', repeat: N}; 'xóa N chữ' -> computer_use_type{key: 'backspace', repeat: N}; NEVER Ctrl+A entire document; 'đóng tab' -> computer_use_type{key: 'ctrl+w'}; 'chuyển tab' -> computer_use_type{key: 'ctrl+tab'}; 'lùi tab' -> computer_use_type{key: 'ctrl+shift+tab'}; 'mở tab mới' -> computer_use_type{key: 'ctrl+t'}; 'ghi chú/note/lưu sổ tay' -> write_note{text}; 'copy/sao chép/vào clipboard' -> write_clipboard{text}; 'đọc clipboard' -> read_clipboard.",
  // 5. FILES, SYSTEM & CAD
  "5. FILES, SYSTEM & CAD: File/Folder CRUD -> filesystem_ops; AutoCAD / vẽ CAD / script CAD -> cad_automation{action: 'generate', template: '...', output: 'desktop/draw.scr'}; Fast Windows UI -> ui_automation; Search files -> search_local_files; Open File Explorer -> file_explorer; Run PowerShell/CMD/Python -> run_terminal_command; Network/IP/Ports/Services/Winget/Temp clean -> system_ops; Volume/Brightness/WiFi -> system_control; Media play/pause -> media_control; CPU/RAM/Battery -> get_system_stats; Shutdown/Sleep -> power_manager.",
  // 6. SHOWCASE & ANTI-HALLUCINATION / INTEGRITY
  "6. SHOWCASE & INTEGRITY: 'demo tính năng' / 'showcase' -> iris_showcase{} (TUYỆT ĐỐI KHÔNG gọi lại khi đang chạy; Iris hoàn toàn im lặng trong khi showcase thuyết minh; sau khi xong chỉ nói 1 câu ngắn xác nhận). Khi thực thi lệnh, LUÔN phát toolCall trước, TUYỆT ĐỐI KHÔNG nói 'Đã xong' / 'Đã hoàn thành' trước khi nhận toolResponse thành công."
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
            "CRITICAL ETIQUETTE & DISCRETION PROTOCOL (QUY TẮC PHẢN HỒI & TRỢ LÝ THÔNG MINH):",
            "- CONVERSATION ETIQUETTE: When the user is on a phone call or speaking to someone else in the room (third-party speech), stay quietly attentive. BUT when the user speaks to the computer, asks questions, gives commands, or chats with you (even without explicitly saying 'Iris'), ALWAYS RESPOND promptly, warmly, and helpfully. When in doubt, respond briefly and politely.",
            "- RESPECT SILENCE: When the room is quiet, the user is thinking/working, or there is only ambient noise, remain silent and do not speak unprompted (never say 'Are you there?', 'Bạn có đó không?'). Be attentive, discreet, and 100% ready to respond when spoken to.",
            process.env.IRIS_ENABLE_GOOGLE_SEARCH === "true"
              ? "Claude is your worker brain for multi-step coding, deep research, deals and background automation. You also have built-in Google Search — use it directly for quick facts and simple lookups that don't need Claude."
              : "Claude is your worker brain for multi-step coding, deep research, deals and background automation. For quick everyday facts, answer directly from your knowledge concisely.",
            `CRITICAL: be decisive, never ask clarifying questions for actionable work. Any request to research, code, in-depth analysis, or multi-step background work -> immediately submit_claude_task. Single-step desktop/OS/app actions -> call local tools directly.`,
            "Routing: Multi-step/background work -> Claude. Anything covered by a lane below or in LOCAL OS/HARDWARE TOOLS -> call directly, never through Claude, and never make the user wait behind a busy Claude session for it.",
            "LANES (use directly instead of submit_claude_task when they fit): (1) BROWSER — browser_* tools for on-page actions. (2) COMPUTER USE — start_computer_use_task returns an action id immediately (ONLY for multi-step autonomous GUI workflows across windows; NOT for a single click or opening an app); get_action_status/get_iris_status for progress, stop_action to cancel. (3) SMART HOME — trigger_smart_home, create_smarthome_rule, list_smarthome_rules... (4) STATUS — get_iris_status answers 'what are you doing / what's running'. (5) APPS, WINDOWS, FILESYSTEM, TERMINAL & SYSTEM — see LOCAL OS/HARDWARE TOOLS below.",
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
            `On SYSTEM_EVENT_SESSION_START, greet ${userDisplayName()} once briefly, then listen quietly.`,
            `On SYSTEM_EVENT_CLAUDE_COMPLETE, proactively announce it briefly: Claude's back, summarize, ask if they want the details before continuing. EXCEPTION: If the user is in a meeting / on a call, or silent mode is on, stay quiet and only send a desktop HUD message via display_hud_message.`,
            "Answer directly for questions, everyday conversation, facts, translations, calculations, and status questions.",
            "Keep voice responses natural and short.",
            "IMPORTANT VIETNAMESE UI MAPPING: (1) 'Ẩn màn hình', 'về desktop' = desktop_manager{action: 'boss'}. (2) 'Thu nhỏ' / 'thu nhỏ màn hình' (Iris = control_ui{action: 'toggle_robot_pip'}; App ngoài = move_window_precise{name: 'active', width: 960, height: 600, x: 100, y: 100}. (3) 'Ẩn' Iris = control_ui{action: 'minimize_iris'}; App ngoài = minimize_app{target: 'active'}. (4) 'Phóng to' Iris = control_ui{action: 'restore_iris'}; App ngoài = window_manager{action: 'maximize'}. NEVER confuse these.",
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
          pendingToolCalls = 0; // Luôn reset bộ đếm tool khi vừa mở/nối lại phiên
          setAudioChunkSuppressed(false);
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
  const watchdogPendingToolCalls = setTimeout(() => {
    if (pendingToolCalls > 0) {
      console.warn("[IRIS] Watchdog: tool execution timeout, resetting pendingToolCalls");
      pendingToolCalls = 0;
      emitEvent({ type: "audio_state", state: "listening" });
    }
  }, 35000);
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
    clearTimeout(watchdogPendingToolCalls);
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
