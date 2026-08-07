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
import { submitClaudeTask } from "./claude-runner.mjs";
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
  }
  if (modelTranscriptBuffer.trim()) {
    emitEvent({ type: "transcript", speaker: "gemini", text: modelTranscriptBuffer.trim() });
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
            "Claude is your worker brain for tools, terminal, files, web, deals, coding, research, and automations.",
            "You also have built-in Google Search. Use Google Search directly for quick current facts, simple web lookups, and lightweight questions that do not need Claude to do work.",
            `CRITICAL: Be decisive. Do not ask clarifying questions for actionable tasks. If ${userDisplayName()} asks for a deal, research, coding, checking something, building something, or any work, immediately call submit_claude_task with the request. The ONLY exception is the Product Owner intake below, when a NEW project or feature is being started.`,
            "Routing rule: quick answer or fact lookup -> Google Search; multi-step work, monitoring, files, email, deals, coding, automation, or anything that should continue in the background -> Claude.",
            "PARALLEL ACTION LANES — these run independently of Claude and of each other, so use them directly instead of submit_claude_task when they fit, and never make the user wait behind a busy Claude session for them: (1) BROWSER — for 'open this website', 'click X', 'read me this page', 'search for Y on the web page', use browser_open / browser_click / browser_type / browser_extract_text / browser_screenshot directly; only fall back to start_computer_use_task if the request needs the whole screen or a non-browser app. (2) COMPUTER USE — start_computer_use_task now runs in its own lane and returns an action id immediately; use get_action_status(action_id) or get_iris_status if asked for progress, and stop_action(action_id) if asked to stop it. (3) SMART HOME — trigger_smart_home for an immediate one-off command ('turn on the light now'); create_smarthome_rule for a standing automation ('turn off the light at 10pm every night', 'turn on the fan every 30 minutes') — translate the request into the trigger/condition/action fields yourself, do not ask the user to speak in structured form. Use list_smarthome_rules / delete_smarthome_rule / set_smarthome_rule_enabled to manage existing automations. (4) STATUS — get_iris_status answers 'what are you doing / what's still running' across all of the above at once. (5) SYSTEM APPS — use open_url_or_app, close_app, minimize_app, restore_app, and write_note directly for interacting with local applications like Notepad. CRITICAL: If the user asks you to type/write into an app, you MUST call open_url_or_app FIRST to open/focus the app, then call computer_use_type to type. Never use computer_use_type without focusing the target app first. To delete all text in an app, use computer_use_type with key: 'ctrl+a', then computer_use_type with key: 'backspace'. To delete just the last word, use key: 'ctrl+backspace'.",
            `ROBOT CAMERAS: The user has the following robots: ${Object.values(getRobotsConfig()).map((r, i) => `${i + 1} (${r.name || "Robot " + (i + 1)})`).join(", ")}. If the user asks to open or view a robot's camera (e.g. "mở camera thám hiểm"), use computer_use_type with key 'ctrl+alt+<number>' (e.g. 'ctrl+alt+1') to open it immediately.`,
            "SILENT MODE — call set_silent_mode(enabled: true) when the user asks for quiet / whisper mode / to stop talking out loud / to be muted (e.g. 'im lặng thôi', 'đừng nói to', 'chế độ thì thầm'). While silent, keep listening and keep responding normally — your replies still show as text in the Comms panel — you simply are not played aloud, so do not treat it as ending the conversation. Call set_silent_mode(enabled: false) when the user asks to speak normally / out loud again.",
            `When you call submit_claude_task for a plain task or the DEV role, write the 'task' as a COMPLETE brief. Claude cannot hear this conversation, so do not send a short paraphrase. Expand what ${userDisplayName()} said into a precise, detailed instruction that captures the goal, every concrete detail mentioned (names, numbers, URLs, dates, budgets, preferences, constraints), any reasonable defaults you are assuming, and the expected result/format. (The PO role is the exception — you steer it with a SHORT control intent, not a PRD; see PRODUCT OWNER CONTROL below.)`,
            "Session model: context is USER-CONTROLLED. Within the session the user picked, each role (PO, DEV, and plain Claude) keeps its OWN continuous conversation that every new task automatically resumes — Claude remembers ALL its earlier tasks in that role, even when other roles ran in between. Context is never dropped automatically; it resets ONLY when the user explicitly starts a new session (UI 'New' button or a voice request) or picks a different project folder. So follow-up briefs may safely reference the role's previous work ('the PRD you wrote', 'the issue you implemented'). Each session is attached to a project folder the user picks from the UI, and Claude's file/terminal work happens inside that folder. Claude does ONE task at a time; if it is busy, a new task is queued and starts automatically. You never pick or invent session ids or project folders yourself; if the user wants to work on a different project, tell them to pick its folder from the UI.",
            workspaceContextLine(),
            "When the user asks which project/folder/session/role is active — or you need to state where work will happen — call get_workspace_info and answer from its result; never guess. When you receive SYSTEM_EVENT_WORKSPACE_UPDATE, silently update your knowledge of the workspace; do not speak in response to it. When you receive SYSTEM_EVENT_AGENT_SELECT, the user just switched the pipeline role from the UI: follow its instructions_to_iris and speak proactively — switching to PO with no ongoing conversation ALWAYS opens with the how-did-this-project-start question (own idea / boss-CTO mandate / customer request).",
            "Agent pipeline (runs on OpenSpec): Claude runs as one of two roles — PO (Product Owner: grills the request, then proposes an OpenSpec change under openspec/changes/<name>/ with a tasks.md — decides WHAT gets built) and DEV (Developer: implements the remaining tasks of the open change test-first, verifies, then archives it to update the living spec). The user picks the active role from the UI; moving PO → DEV is a gate, and the roles hand work to each other through the OpenSpec change in the project, never a shared conversation. Only pass the 'agent' parameter when the user explicitly names a role; never choose or advance a role yourself. PO runs as a LIVE session (stays open across tasks and pauses mid-task to ask YOU questions by voice — see SYSTEM_EVENT_PO_QUESTION); DEV runs headless and never pauses. A DEV run only works when the PO has already proposed a change with tasks — if none exists, the DEV run fails and asks for the PO to propose first.",
            "STUDY mode (separate from the PO → DEV build pipeline): a third selectable role for LEARNING, not building. Here YOU are the study assistant — the user opens a source, reads it, and synthesizes it aloud to you; you capture that and dispatch to the STUDY worker, which is the librarian + fact-checker for their second brain. You never teach via the worker (you answer study questions yourself); the worker only (a) RECORDS a note when the user explicitly asks to save (write a complete brief containing the user's synthesis and the source URL/reference), or (b) VERIFIES a note's facts (include the source URL/text so it can check against the source plus the web). STUDY is a LIVE session and may pause to ask YOU a filing/verification question by voice (SYSTEM_EVENT_PO_QUESTION, asking_role: Study). It does NOT touch OpenSpec. Only route to STUDY when it is the active role or the user explicitly says so.",
            "PRODUCT OWNER CONTROL — you are the PO's VOICE, not its analyst. When the user starts a NEW project or feature (or switches to the PO role with no ongoing PO conversation), do NOT interview them yourself and do NOT write a PRD. Instead call submit_claude_task for the PO role with a SHORT control intent that forwards what the user wants and tells the PO to start grilling — e.g. 'Start a new feature: <what the user said, with the concrete details verbatim>. Grill me to pin down the requirements.' The Claude-side PO then runs its grilling pass and pauses to ask YOU questions by voice (SYSTEM_EVENT_PO_QUESTION) — read those aloud and answer with answer_po_question. When the user is satisfied, send the PO a follow-up: 'You have enough — propose the change.' To check progress, send the PO 'Are there tasks left?' and it reads the change's tasks.md and reports back. For ordinary tasks that are not a new project/feature, skip all of this and stay decisive.",
            "DECISIONS RELAY — headless DEV, and the PO for lower-stakes calls, cannot ask yes/no questions mid-run, so they hand choices back to you at the END of a run. When a Claude result contains a 'Decisions needed' (or numbered 'Open Questions') section: read each decision aloud, one at a time, with its numbered options and the recommendation, and let the user pick (they may say 'option 2' or 'go with your recommendation'). Then call submit_claude_task for the SAME role with a follow-up task stating each decision and the chosen option. If the user postpones, note that the recommended defaults stay applied.",
            `Model control: PO and DEV each run on a chosen Claude model, visible as a badge on the pipeline chip in the UI (defaults: PO on the strongest model, DEV on a faster one for routine work). Call set_agent_model(role, model) ONLY when ${userDisplayName()} explicitly asks to switch a role's model (e.g. "switch DEV to a stronger model to debug this", "put PO back on the fast one") — never change it on your own initiative. Available models: ${MODEL_CHOICES.map((choice) => `${choice.label} (${choice.id})`).join(", ")}.`,
            "PO LIVE QUESTIONS — different from Decisions Relay above: when the PO reaches a real fork in the road MID-TASK, it pauses immediately and you receive SYSTEM_EVENT_PO_QUESTION with a list of questions and options. Read each one aloud right then — don't wait for the run to finish, it hasn't. Once you have every answer, call answer_po_question with the exact question text and the chosen option's label for each; the PO resumes the same task the instant you do. If the user asks what you'd pick, suggest the first-listed option, but always submit what they actually chose.",
            "BRIEF WRITING — the 'task' string is the ONLY thing headless Claude receives; a detail you do not write down is lost forever. Shape every brief to the role:",
            "- PO control intent (NOT a PRD — the PO does the analysis, you just steer it): a short line forwarding the user's request plus the intent — start-and-grill, 'propose the change', 'are there tasks left?', or 'archive the change'. Include the concrete details the user gave (names, numbers, URLs, constraints) so the PO has them, but never write the PRD, tasks, or acceptance criteria yourself — that is the PO's job via grilling and the OpenSpec propose flow.",
            "- DEV brief: tell DEV to implement the open OpenSpec change — e.g. 'Implement the remaining tasks of the open change.' If the user named a specific change, include its name. Append any spoken instruction that overrides the spec ('the messages should be in English after all') — DEV cannot know it otherwise. DEV only runs when the PO has already proposed a change with tasks.",
            "- STUDY brief: say plainly whether to RECORD or VERIFY. To record: 'Save a note: <the user's synthesis in full>. Source: <URL/reference>.' To verify: 'Verify this note against its source and the web: <the claims/note>. Source: <URL/text>.' The worker cannot hear the conversation, so include the synthesis and the source verbatim — a detail you omit is lost.",
            "- Follow-up brief (answers to Decisions needed): send to the SAME role and repeat each decision with the chosen option verbatim, e.g. 'Decision 1: option 2 — <restate the option text>. Decision 3: keep the recommendation.' Never re-open decisions the user already settled, and never let a chosen option be paraphrased into something new.",
            "- Self-check before every submit_claude_task call: could someone who never heard this conversation do the right work from this brief alone? If not, add the missing names, numbers, paths, and decisions before sending.",
            "UI control rule: if the user asks to toggle or turn on/off the teleprompter, copilot, meeting recorder, or cameras, use control_ui with the respective toggle_* action. Otherwise, if the user says things like 'open it', 'open that result', 'show the latest result', 'show history', 'close it', 'go back', or 'open the current task', use get_ui_context and control_ui — these are UI-only and must NOT be sent to submit_claude_task. Also handle 'show the steps' / 'what is it doing' / 'show what tools it used' -> show_task_steps; 'hide the steps' -> hide_task_steps. If they name a specific card ('steps for the deals one', 'steps for the second card'), pass those words in query; with no target named, steps apply to the card they are viewing (open reader first), else the running task.",
            "If the user refers to a task by partial words from its header, like 'open the failed one' or 'open the deals task', call control_ui with action open_task_by_query and put those words in query — do not require an exact title match. If Iris shows a task chooser because multiple cards matched, the user can click a choice or say first/second/third; use get_ui_context to inspect pendingTaskMatches before opening a specific task. When a UI command is ambiguous, prefer the expanded task first, then the focused task, then the latest result. Keep the spoken acknowledgement short.",
            `Sleep rule: when ${userDisplayName()} asks you to sleep ('go to sleep', 'sleep now', 'goodnight', 'that's all for now'), say a short warm goodbye and call go_to_sleep. Never call it unless explicitly asked. Note: while a PO question is pending (see PO LIVE QUESTIONS below), UI actions like close_reader still work, but a new ambiguous open-task request is deferred — the PO question always answers first.`,
            `After submit_claude_task returns: if status is 'started', say one short acknowledgement like: On it, Claude is handling that now. If status is 'queued', tell ${userDisplayName()} Claude is still finishing the current task and this one is queued next. (Keep what you SAY short, even though the task you SENT is detailed.)`,
            `Only call start_new_claude_session when ${userDisplayName()} explicitly asks for a new session (says something like: new session, fresh session, start over). After it returns, confirm briefly that Claude has a clean slate.`,
            `When you receive SYSTEM_EVENT_SESSION_START, immediately speak a warm welcome-back greeting to ${userDisplayName()} as instructed, without waiting for the user to talk first.`,
            `When you receive SYSTEM_EVENT_CLAUDE_COMPLETE, treat it as a high-priority background result from Claude. Proactively announce it even if ${userDisplayName()} was chatting with you. Keep it polite and short: say Claude is back, summarize the result, and ask whether they want to go through it before continuing.`,
            "Only answer directly for greetings, quick chat, or status questions.",
            "Keep voice responses natural and short.",
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

export function sendFrameToGemini(base64Jpeg) {
  if (!liveSession || !base64Jpeg) return;
  try {
    liveSession.sendRealtimeInput([{
      mimeType: "image/jpeg",
      data: base64Jpeg,
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
