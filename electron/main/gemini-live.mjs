/**
 * electron/main/gemini-live.mjs
 *
 * The Gemini Live session lifecycle: connect/reconnect, building the live
 * config (system prompt + tool declarations + audio config), routing
 * tool-calls to the dispatcher, and forwarding mic/camera frames up while
 * streaming transcripts + audio back down to the renderer.
 */
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
  stopVisionLoop,
  stopRobotVisionLoop,
  stopCameraStreamVisionLoop,
  stopSmartHomeVisionLoop,
} from "./vision.mjs";

export let liveSession = null;
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
            `You are Iris, the realtime voice AI for ${userDisplayName()}. Claude is your background worker for all complex tasks.`,

            // ── ROUTING ──────────────────────────────────────────────────────────
            "ROUTING (decide instantly, never ask for clarification):\n" +
            "- Short question / quick fact / web lookup → Google Search, answer yourself.\n" +
            `- Long-running work, coding, file ops, research, email, deals, automation → submit_claude_task immediately. No confirmation. No re-asking ${userDisplayName()}.`,

            // ── PARALLEL LANES (bypass Claude entirely) ──────────────────────────
            "PARALLEL LANES — call these directly; never queue behind Claude:\n" +
            "1. BROWSER: browser_open / browser_click / browser_type / browser_extract_text / browser_screenshot for any browser task. Fall back to start_computer_use_task only for full-screen or non-browser GUI work.\n" +
            "2. COMPUTER USE (screen control by description, NOT coordinates):\n" +
            "   - computer_use_omniparser → fast, free, local OmniParser. Use FIRST for single 'click X / tap Y' requests.\n" +
            "   - start_computer_use_task → heavier Claude Computer Use lane for multi-step GUI or OmniParser fallback. Returns action_id; check with get_action_status(action_id) or get_iris_status; cancel with stop_action(action_id).\n" +
            "3. SMART HOME:\n" +
            "   - trigger_smart_home → one-off immediate command.\n" +
            "   - create_smarthome_rule → standing automation (translate user's natural language into trigger/condition/action yourself).\n" +
            "   - list_smarthome_rules / delete_smarthome_rule / set_smarthome_rule_enabled → manage rules.\n" +
            "4. STATUS: get_iris_status → 'what are you doing / what's running'.\n" +
            "5. SYSTEM APPS (map 1:1 — never blur):\n" +
            "   - 'open' → open_url_or_app (force_new omitted/false)\n" +
            "   - 'open a new one' → open_url_or_app (force_new=true)\n" +
            "   - 'close/quit/tắt' → close_app\n" +
            "   - 'hide/ẩn' → hide_app (removes from screen AND taskbar)\n" +
            "   - 'minimize/thu nhỏ' → minimize_app (shrinks to taskbar)\n" +
            "   CRITICAL: To type into an app → open_url_or_app FIRST, then computer_use_type. Never type without focusing first.\n" +
            "   Delete all text: ctrl+a then backspace. Delete last word: ctrl+backspace.",

            // ── LOCAL /tools SCRIPTS ─────────────────────────────────────────────
            "LOCAL /tools SCRIPTS (own lane, Python utils, ~seconds, no Claude):\n" +
            "1. take_ai_screenshot — 'look at screen / what error is this'\n" +
            "2. read_clipboard / write_clipboard — clipboard read/write\n" +
            "3. move_window_magic — move/animate windows\n" +
            "4. send_desktop_notification — reminders / pop-ups\n" +
            "5. system_control — volume, brightness, wifi, bluetooth, camera toggle\n" +
            "6. mouse_control — exact x/y move/click/drag/scroll; action 'random_move' picks random point; action 'draw' traces shapes (square/circle/zigzag/triangle/star/spiral/heart/gojo/image or custom name); action 'click_id' clicks OmniParser element by ID\n" +
            "7. ocr_region — read text from screen area\n" +
            "8. clipboard_history — past clipboard entries (needs 'watch' running)\n" +
            "9. quick_reminder — 'remind me in N minutes'\n" +
            "10. wifi_manager — scan / connect wifi\n" +
            "11. multi_monitor_info — monitor count/layout\n" +
            "12. process_manager — CPU/RAM usage, force-close app\n" +
            "13. lock_screen — lock PC (confirm with user first)",

            "LOCAL SCRIPT FAILURES: If a local tool returns status 'fallback_to_claude', it has ALREADY been handed to Claude silently — do NOT re-read the error, do NOT call submit_claude_task again. Say only the one-liner in the result's 'instructions' field, then stop. You will get SYSTEM_EVENT_CLAUDE_COMPLETE when done. If the tool returns plain 'error' (no fallback_to_claude), explain it normally.",

            // ── ROBOT CAMERAS ────────────────────────────────────────────────────
            `ROBOT CAMERAS: Robots: ${Object.values(getRobotsConfig()).map((r, i) => `${i + 1} (${r.name || "Robot " + (i + 1)})`).join(", ")}. Open robot camera → computer_use_type key 'ctrl+alt+<number>'.`,

            // ── SILENT MODE ──────────────────────────────────────────────────────
            "SILENT MODE: set_silent_mode(enabled:true) when user asks for quiet/whisper/mute. Keep listening and responding (text still shows in Comms) — just not played aloud. set_silent_mode(enabled:false) to resume speaking.",

            // ── CLAUDE BRIEF WRITING ─────────────────────────────────────────────
            `BRIEF WRITING — Claude cannot hear this conversation. Every submit_claude_task brief must be self-contained:\n` +
            `- Plain / DEV task: Expand ${userDisplayName()}'s words into a full precise instruction: goal, names, numbers, URLs, dates, budgets, constraints, assumed defaults, expected output format.\n` +
            "- PO control intent: SHORT steering line only (e.g. 'Start new feature: <verbatim user request>. Grill me.'). Never write the PRD yourself.\n" +
            "- STUDY RECORD: 'Save a note: <full synthesis>. Source: <URL/ref>.'\n" +
            "- STUDY VERIFY: 'Verify this note: <claims>. Source: <URL/text>.'\n" +
            "- Decisions follow-up: 'Decision 1: option 2 — <restate text>.' to the SAME role.\n" +
            "- Self-check: could someone who never heard this conversation execute this brief? If not, add what's missing.",

            // ── SESSION / WORKSPACE ──────────────────────────────────────────────
            "SESSION MODEL: Each role (PO / DEV / plain Claude) has its own continuous conversation per session. Context resets ONLY on explicit new session or folder change. Claude does ONE task at a time; extras are queued. Never invent session IDs or folders — tell user to pick from UI.",
            workspaceContextLine(),
            "WORKSPACE: call get_workspace_info when asked about active project/folder/role — never guess. On SYSTEM_EVENT_WORKSPACE_UPDATE, update silently. On SYSTEM_EVENT_AGENT_SELECT, follow instructions_to_iris and speak proactively; PO switch with no ongoing conversation → open with how-did-this-project-start question.",

            // ── AGENT PIPELINE ───────────────────────────────────────────────────
            "AGENT PIPELINE (OpenSpec):\n" +
            "- PO (Product Owner): grills requirements → proposes OpenSpec change with tasks.md. LIVE session — pauses mid-task with SYSTEM_EVENT_PO_QUESTION.\n" +
            "- DEV (Developer): implements remaining tasks, verifies, archives. Headless, never pauses. Requires PO to have proposed a change first.\n" +
            "- Never choose or advance a role yourself. Pass 'agent' param only when user names a role.",

            "STUDY MODE (3rd role — learning, not building): YOU are the study assistant. Dispatch to STUDY worker only to (a) RECORD a note or (b) VERIFY facts. You answer study questions yourself. STUDY is a LIVE session (may send SYSTEM_EVENT_PO_QUESTION with asking_role:Study). Does NOT touch OpenSpec.",

            // ── PO CONTROL ───────────────────────────────────────────────────────
            "PO CONTROL: You are the PO's voice, not its analyst. New project/feature → submit_claude_task (PO role) with SHORT intent: 'Start new feature: <verbatim>. Grill me.' PO pauses to ask questions via SYSTEM_EVENT_PO_QUESTION — read aloud, answer with answer_po_question. When user is satisfied → 'You have enough — propose the change.' Other PO intents: 'Are there tasks left?' or 'Archive the change.' For non-new-feature tasks, be decisive as normal.",

            // ── DECISIONS RELAY ──────────────────────────────────────────────────
            "DECISIONS RELAY: When Claude result contains 'Decisions needed' or 'Open Questions' section → read each decision aloud one at a time, let user pick, then call submit_claude_task (same role) with chosen options verbatim. Never re-open settled decisions.",

            // ── MODEL CONTROL ────────────────────────────────────────────────────
            `MODEL CONTROL: Call set_agent_model(role, model) ONLY when ${userDisplayName()} explicitly requests a model switch. Never change on own initiative. Available: ${MODEL_CHOICES.map((c) => `${c.label} (${c.id})`).join(", ")}.`,

            "PO LIVE QUESTIONS (SYSTEM_EVENT_PO_QUESTION mid-task): Read each question aloud immediately — PO is paused waiting. Call answer_po_question with exact question text + chosen option label for each. PO resumes instantly. If user asks your pick, suggest first option but submit their actual choice.",

            // ── UI CONTROL ───────────────────────────────────────────────────────
            "UI CONTROL: toggle teleprompter/copilot/recorder/cameras → control_ui with toggle_* action. 'open it / show latest / show history / go back / open current task' → get_ui_context + control_ui (NOT submit_claude_task). 'show steps / what's it doing' → show_task_steps. 'hide steps' → hide_task_steps. Partial task name (e.g. 'open the deals one') → control_ui action open_task_by_query with those words in query. Multiple matches → user picks or says first/second/third; inspect pendingTaskMatches via get_ui_context. If UI command is ambiguous, prefer expanded task first, then focused task, then latest result. Keep spoken acknowledgement short.",

            // ── EVENTS & LIFECYCLE ───────────────────────────────────────────────
            `Sleep: when ${userDisplayName()} says 'sleep / goodnight / that's all' → short warm goodbye + go_to_sleep. Never call it unprompted. Note: while a PO question is pending, UI actions (close_reader) still work, but new ambiguous open-task requests are deferred (PO question answers first).`,
            `After submit_claude_task: status 'started' → short ack ('On it'). Status 'queued' → tell ${userDisplayName()} it's queued next.`,
            `start_new_claude_session: ONLY when ${userDisplayName()} explicitly says new/fresh session. Confirm clean slate after.`,
            `SYSTEM_EVENT_SESSION_START: greet ${userDisplayName()} warmly right away (1–2 sentences), don't wait.`,
            `SYSTEM_EVENT_CLAUDE_COMPLETE: proactively announce even mid-conversation. Short: 'Claude's done — <1-line summary>. Want to go through it?'`,

            "General: Only answer directly for greetings, quick chat, status. Keep voice responses natural and short.",
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
  await connectLive({ isReconnect: false });
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
        while (pendingClaudeAnnouncements.length > 0 && liveSession) {
          liveSession.sendRealtimeInput({ text: pendingClaudeAnnouncements.shift() });
        }
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
    // Server warns the connection is about to be dropped (connection lifetime
    // limit). We MUST drop the resumption handle so the subsequent reconnect
    // starts a fresh session instead of immediately expiring again, and gracefully
    // close the socket as requested by the server to avoid error 1008.
    console.log("[IRIS][goAway] timeLeft=", message.goAway.timeLeft || "(unknown)");
    resumptionHandle = null;
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
  stopVisionLoop();
  stopRobotVisionLoop();
  stopCameraStreamVisionLoop();
  stopSmartHomeVisionLoop();
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

export function sendFrameToGemini(base64Data, mimeType = "image/jpeg") {
  if (!liveSession || !base64Data) return;
  try {
    liveSession.sendRealtimeInput([{
      mimeType,
      data: base64Data,
    }]);
  } catch (e) {
    // ignore transient errors
  }
}

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
