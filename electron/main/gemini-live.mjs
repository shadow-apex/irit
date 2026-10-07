/**
 * electron/main/gemini-live.mjs
 *
 * The Gemini Live session lifecycle: connect/reconnect, building the live
 * config (system prompt + tool declarations + audio config), routing
 * tool-calls to the dispatcher, and forwarding mic/camera frames up while
 * streaming transcripts + audio back down to the renderer.
 */
import { buildVideoInput, stripDataUrl } from "./live-input.mjs";
import { GoogleGenAI } from "@google/genai";
import { emitToRenderer, emitEvent } from "./events.mjs";
import { mainWindow } from "./window-manager.mjs";
import { buildClaudeTools } from "./claude-tools-catalog.mjs";
import { executeClaudeTool } from "./tool-dispatcher.mjs";
import { canvasCapability, secondBrainCapability } from "./capabilities.mjs";
import { startCompanionServer } from "../companion-server.mjs";
import { pendingClaudeAnnouncements } from "./notify-iris.mjs";
import { userDisplayName, workspaceContextLine } from "./session-store.mjs";
import { MODEL_CHOICES } from "./agent-roster.mjs";
import { checkClaudeStatus } from "./claude-cli.mjs";
import { updateTrayMenu } from "./window-manager.mjs";
import { submitClaudeTask, sendWebMessage } from "./claude-runner.mjs";
import { getRobotsConfig } from "./device-config.mjs";
import {
  stopAllVisionLoops,
} from "./vision.mjs";

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

export const GreetGate = {
  done: true,
  timer: null,
  arm() {
    this.done = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), 8000);
  },
  fire() {
    if (this.done) return;
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    sendWelcomeGreeting();
  },
};

export function flushTranscripts() {
  if (userTranscriptBuffer.trim()) {
    emitEvent({ type: "transcript", speaker: "you", text: userTranscriptBuffer.trim() });
    // sendWebMessage(`[Bạn🗣️]: ${userTranscriptBuffer.trim()}`);
  }
  if (modelTranscriptBuffer.trim()) {
    emitEvent({ type: "transcript", speaker: "gemini", text: modelTranscriptBuffer.trim() });
    sendWebMessage(`[Gemini🎙️]: ${modelTranscriptBuffer.trim()}`);
  }
  userTranscriptBuffer = "";
  modelTranscriptBuffer = "";
}

export function buildLiveConfig(resumeHandle) {
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
            "Claude is your worker brain for terminal, files, web, coding, research, deals and background automation. You also have built-in Google Search — use it directly for quick facts and simple lookups that don't need Claude.",
            `CRITICAL: be decisive, never ask clarifying questions for actionable work. Any request to research, code, check, build, or find a deal -> immediately submit_claude_task. Only exception: a NEW project/feature goes through PO intake (see PRODUCT OWNER CONTROL below).`,
            "Routing: quick fact -> Google Search. Multi-step/background work -> Claude. Anything covered by a lane below -> call that lane directly, never through Claude, and never make the user wait behind a busy Claude session for it.",
            "LANES (use directly instead of submit_claude_task when they fit): (1) BROWSER — browser_open/browser_click/browser_type/browser_extract_text/browser_screenshot for on-page actions; fall back to start_computer_use_task only for whole-screen or non-browser work. (2) COMPUTER USE — start_computer_use_task returns an action id immediately; get_action_status/get_iris_status for progress, stop_action to cancel. (3) SMART HOME — trigger_smart_home for a one-off command; create_smarthome_rule for a standing automation (build the trigger/condition/action fields yourself from what the user said); manage existing ones with list_smarthome_rules/delete_smarthome_rule/set_smarthome_rule_enabled. (4) STATUS — get_iris_status answers 'what are you doing / what's running'. (5) APPS & WINDOWS — open_url_or_app, close_app, hide_app, minimize_app, restore_app, write_note, move_window_magic, move_window_precise. To type into an app: open_url_or_app first to focus it, THEN computer_use_type — never type unfocused. Clear all text: computer_use_type key 'ctrl+a' then 'backspace'; clear last word: 'ctrl+backspace'. (6) OS/HARDWARE — system_control (volume/brightness/wifi/bluetooth/camera toggle), mouse_control, media_control, power_manager (sleep/shutdown/restart), lock_screen, focus_assist, desktop_manager, process_manager, wifi_manager, read_clipboard/write_clipboard/clipboard_history, send_desktop_notification, quick_reminder, take_ai_screenshot, ocr_region, color_picker, active_window_info, idle_time, multi_monitor_info, view_image, search_local_files, read_system_notifications — each is self-explanatory from its own tool description, call the matching one directly; never route hardware/OS requests through submit_claude_task.",
            `ROBOT CAMERAS: user's robots are ${Object.values(getRobotsConfig()).map((r, i) => `${i + 1} (${r.name || "Robot " + (i + 1)})`).join(", ")}. To open/view one's camera, use computer_use_type with key 'ctrl+alt+<number>' immediately.`,
            "SILENT MODE: set_silent_mode(enabled: true) on 'quiet/whisper/mute' requests ('im lặng thôi', 'đừng nói to') — keep listening and replying as text, just not aloud. set_silent_mode(enabled: false) to resume speaking.",
            `submit_claude_task briefs (plain/DEV tasks): Claude can't hear this conversation, so write a COMPLETE, self-contained instruction — goal, every concrete detail (names, numbers, URLs, dates, budgets, constraints), assumed defaults, expected output. (PO is the exception: a short control intent, not a brief — see below.)`,
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
            `SLEEP: on 'go to sleep'/'goodnight'/'that's all for now', a short goodbye then go_to_sleep — only when explicitly asked. A pending PO question always gets answered before an ambiguous new open-task request.`,
            `After submit_claude_task: 'started' -> one short line ("On it, Claude's on it now"); 'queued' -> tell ${userDisplayName()} it's queued behind the current task. Keep what you SAY short even when what you SENT was detailed.`,
            `start_new_claude_session only on an explicit request (new/fresh session, start over); confirm briefly afterward.`,
            `On SYSTEM_EVENT_SESSION_START, speak a warm welcome-back greeting to ${userDisplayName()} immediately, without waiting for them to talk first.`,
            `On SYSTEM_EVENT_CLAUDE_COMPLETE, proactively announce it (even mid-chat), briefly: Claude's back, summarize, ask if they want the details before continuing.`,
            "Answer directly only for greetings, quick chat, or status questions.",
            "Keep voice responses natural and short.",
            "IMPORTANT VIETNAMESE UI MAPPING: When the user says 'phongto', 'phóng to', 'moro', 'mở rộng', they want to maximize/open the ui. When they say 'thu nhỏ tab' or 'cho nhỏ lại', they want Picture-in-Picture mode -> use control_ui with action toggle_robot_pip. When they say 'ẩn tab' or 'ẩn đi' or 'dấu trừ', they want to minimize the app to taskbar -> use minimize_app (e.g. target 'Irit.exe'). NEVER confuse these two!",
            // Ported from myiris: each capability's own prose, spliced in
            // rather than concatenated elsewhere since prose position here is
            // meaningful. Empty string (capability not applicable right now,
            // e.g. pipeline unavailable) drops out cleanly via filter(Boolean).
            canvasCapability.promptFragment(),
            secondBrainCapability.promptFragment(),
            // Claude Brain toggle: inject a CRITICAL override when Claude is disabled.
            !isClaudeEnabled
              ? "CRITICAL: Claude is currently DISABLED in Settings. Do NOT use submit_claude_task. Try to complete the user's request using your other available tools directly (browser, system apps, smarthome, etc.). If a task is too complex or requires Claude, apologize and remind the user to enable Claude in Settings."
              : "",
          ].filter(Boolean).join("\n"),
        },
      ],
    },
  };
}

export function sendWelcomeGreeting() {
  (async () => {
    let reachable = false;
    try {
      const status = await checkClaudeStatus();
      reachable = Boolean(status.reachable);
    } catch {
      reachable = false;
    }
    if (!liveSession) return;

    const claudeLine = reachable
      ? "Claude is online and all channels are connected, so we're good to go."
      : "I'm still bringing Claude online, channels are connecting now.";

    const greeting =
      `SYSTEM_EVENT_SESSION_START: The session just started. Proactively greet ${userDisplayName()} out loud right now in a warm, concise way (1-2 sentences). ` +
      `Say something like: Hi ${userDisplayName()}, welcome back. ${claudeLine} Then ask what they have in mind. ` +
      "Speak this greeting immediately without waiting for the user to talk first.";

    liveSession.sendRealtimeInput({ text: greeting });
  })();
}

export async function startLive() {
  if (liveSession) return liveStatus;
  userStopped = false;
  resumptionHandle = null;
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try { await connectLive({ isReconnect: false }); } catch(err) { console.error('[GEMINI_LIVE_ERROR]', err); emitEvent({ type: 'fatal', message: err.message || String(err) }); throw err; }
  // BUG-COMP-04/COMP-02 FIX: Pass sendFrameToGemini so companion video frames
  // go directly to Gemini Live without an unnecessary renderer round-trip.
  startCompanionServer(emitEvent, sendAudioChunk, mainWindow, sendFrameToGemini);
  return { running: true, pid: process.pid };
}

export async function connectLive({ isReconnect }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    emitEvent({ type: "fatal", message: "GEMINI_API_KEY is not set." });
    throw new Error("GEMINI_API_KEY is not set");
  }

  const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
  ai = new GoogleGenAI({ apiKey });
  emitEvent({ type: "sidecar_status", status: { running: true, model, mode: "webrtc-aec" } });
  emitEvent({ type: "gemini_status", status: "connecting", model });

  liveSession = await ai.live.connect({
    model,
    config: buildLiveConfig(resumptionHandle),
    callbacks: {
      onopen() {
        reconnectAttempts = 0;
        liveStatus = { running: true, pid: process.pid };
        emitEvent({ type: "sidecar_status", status: { running: true, pid: process.pid, model, mode: "webrtc-aec" } });
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
        emitEvent({ type: "fatal", message: "Gemini Live error", error: error?.message || String(error) });
      },
      onclose(event) {
        console.error("[IRIS][close] code=", event?.code, "reason=", event?.reason || "(none)");
        flushTranscripts();
        liveSession = null;
        if (userStopped) {
          liveStatus = { running: false, pid: null };
          emitEvent({ type: "gemini_status", status: "offline" });
          emitEvent({ type: "audio_state", state: "idle" });
          emitEvent({ type: "sidecar_status", status: liveStatus, reason: event?.reason || "closed" });
          updateTrayMenu();
          return;
        }
        scheduleReconnect(event?.reason || "connection closed");
      },
    },
  });
  // G-02: phiên đã được gán — xả các thông báo đã xếp hàng lúc offline/reconnect.
  flushPendingAnnouncements();
}

export function scheduleReconnect(reason) {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    liveStatus = { running: false, pid: null };
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
  const delay = Math.min(500 * 2 ** (reconnectAttempts - 1), 8000);
  console.log(`[IRIS][reconnect] attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms (${reason})`);
  emitEvent({ type: "gemini_status", status: "connecting" });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectLive({ isReconnect: true }).catch((error) => {
      liveSession = null;
      scheduleReconnect(error?.message || String(error));
    });
  }, delay);
}

export async function handleToolCall(toolCall) {
  const functionResponses = [];
  for (const call of toolCall.functionCalls || []) {
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
}

export function handleLiveMessage(message) {
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
    emitToRenderer("live:audio", { data: inlineData.data, mimeType });
    emitEvent({ type: "audio_state", state: "speaking" });
  }

  if (content.turnComplete) {
    flushTranscripts();
    emitEvent({ type: "audio_state", state: "listening" });
  }
}

export async function stopLive() {
  userStopped = true;
  resumptionHandle = null;
  reconnectAttempts = 0;
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
  liveStatus = { running: false, pid: null };
  emitToRenderer("live:interrupt", {});
  emitEvent({ type: "gemini_status", status: "offline" });
  emitEvent({ type: "audio_state", state: "idle" });
  emitEvent({ type: "sidecar_status", status: liveStatus });
  updateTrayMenu();
  return liveStatus;
}

export let _nutJs = null;
export async function getNutJs() {
  if (!_nutJs) _nutJs = await import("@nut-tree-fork/nut-js");
  return _nutJs;
}
// Pre-warm the cache in the background at startup so first gesture is fast.
import("@nut-tree-fork/nut-js").then(m => { _nutJs = m; }).catch(() => { });

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

export function sendAudioChunk(arrayBuffer) {
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

