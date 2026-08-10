/**
 * electron/main/computer-use-tools.mjs
 *
 * "Computer use" + browser-automation tools: OS-level UI control read-back,
 * the OmniParser/computer-use task runners, opening arbitrary URLs/apps
 * safely, the action-lane wrapped variants used by the tool dispatcher, and
 * the browser-automation tool set.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import electron from "electron";
const { shell } = electron;
import { runComputerSession } from "../computer-session.mjs";
import * as browserAgent from "../browser-agent.mjs";
import {
  submitAction,
  getActionStatus,
  listActiveActions,
  laneSnapshot,
  cancelAction,
  isCancelled,
} from "../action-lane.mjs";
import { emitEvent, emitToRenderer } from "./events.mjs";
import { mainWindow } from "./window-manager.mjs";
import { toggleScreenVision, toggleCameraStreamVision } from "./vision.mjs";
import { toggleMeetingRecording } from "./meeting-recording.mjs";
import { toggleCopilotMode, toggleLiveTranscriber } from "./teleprompter.mjs";

// Silent/whisper mode: Iris keeps listening, keeps "speaking" (Gemini still
// generates audio and its transcript still lands in Comms), but playback is
// muted client-side — see set_silent_mode / SILENT_MODE below and the
// matching audio.setSilentOutput() in src/hooks/useAudioPipeline.ts.
let silentMode = false;

export let irisUiContext = {
  tasks: [],
  expandedTaskId: null,
  focusedTaskId: null,
  latestResultTaskId: null,
  pendingTaskMatches: [],
  showHistory: false,
  uiMode: "deck",
};

export const UI_ACTIONS = new Set([
  "open_task",
  "open_task_by_query",
  "open_current_claude_result",
  "open_latest_claude_result",
  "open_claude_history",
  "close_reader",
  "close_history",
  "close_all_overlays",
  "show_task_steps",
  "hide_task_steps",
]);

export function getUiContext() {
  return irisUiContext;
}

export function controlUi({ action, target_id = undefined, query = undefined } = {}) {
  switch (action) {
    case "toggle_teleprompter":
      toggleLiveTranscriber();
      return { status: "success", message: "Toggled Teleprompter (Alt+T)" };
    case "toggle_copilot":
      toggleCopilotMode();
      return { status: "success", message: "Toggled AI Copilot (Alt+A)" };
    case "toggle_meeting_recorder":
      toggleMeetingRecording();
      return { status: "success", message: "Toggled Meeting Recorder (Alt+M)" };
    case "toggle_robot_pip":
      if (mainWindow) mainWindow.webContents.send("ui:toggle-robot-pip");
      return { status: "success", message: "Toggled Robot PiP (Alt+R)" };
    case "toggle_companion_pip":
      if (mainWindow) mainWindow.webContents.send("ui:toggle-companion-pip");
      return { status: "success", message: "Toggled Companion PiP (Alt+C)" };
    case "toggle_screen_vision":
      toggleScreenVision();
      return { status: "success", message: "Toggled Screen Vision (Super+Shift+V)" };
    case "toggle_desk_vision":
      if (mainWindow) mainWindow.webContents.send("vision:toggle-desk");
      return { status: "success", message: "Toggled Desk Vision (Super+Shift+C)" };
    case "toggle_camera_stream_vision":
      return toggleCameraStreamVision();
    case "toggle_smarthome_pip":
      if (mainWindow) mainWindow.webContents.send("ui:toggle-smarthome-pip");
      return { status: "success", message: "Toggled Smart Home Cameras PiP (Alt+H)" };
    case "open_companion_live_view":
      if (mainWindow) mainWindow.webContents.send("companion:open-live-view");
      return { status: "success", message: "Opened Companion Live View." };
  }

  if (!UI_ACTIONS.has(action)) {
    return { status: "error", error: `Unknown UI action: ${action}` };
  }
  emitToRenderer("iris:ui-action", { action, target_id, query });
  return { status: "sent", action, target_id, query };
}

export async function startComputerUseTask(args) {
  const { task } = args;
  emitEvent({ type: "log", level: "info", message: `Starting Computer Use Task: ${task}` });

  // Run asynchronously without blocking Gemini
  runComputerSession(task, (streamEvent) => {
    if (streamEvent.text) {
      emitEvent({ type: "log", level: "info", message: `[ComputerUse] ${streamEvent.text}` });
    }
  }).catch(err => {
    emitEvent({ type: "log", level: "error", message: `[ComputerUse Error] ${err.message}` });
  });

  return { status: "started", message: "I have started taking control of the computer. The actions are running in the background." };
}

export async function startOmniParserTask(args) {
  const { task } = args || {};
  if (!task || typeof task !== "string" || !task.trim()) {
    return { status: "error", message: "Missing or invalid 'task' description for computer_use_omniparser." };
  }
  emitEvent({ type: "log", level: "info", message: `Starting OmniParser Computer Use Task: ${task}` });

  // NOTE: `desktopCapturer` comes from the ESM `electron` default import at the
  // top of this file — do NOT use require() here. This file is loaded as an ES
  // module (main.mjs), so require() is undefined at runtime and previously threw
  // a ReferenceError the moment this function ran (see BUG-EXPO-01 note below for
  // the same lesson learned elsewhere in this file). `path` and `spawn` are also
  // already imported at the top of the file and are no longer needed here since
  // clicking is now delegated to the Python server (see step 3).
  const { desktopCapturer } = electron;

  try {
    // 1. Capture screen
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1920, height: 1080 } });
    if (!sources || sources.length === 0) throw new Error("No screen source found");
    const primarySource = sources[0];
    const imgBuffer = primarySource.thumbnail.toPNG();

    // 2. Send to OmniParser Local API (with timeout so a stuck OCR/YOLO/Gemini
    // call can never hang Iris indefinitely)
    const formData = new FormData();
    formData.append("file", new Blob([imgBuffer], { type: "image/png" }), "screenshot.png");
    formData.append("prompt", task);

    const omniUrl = process.env.OMNIPARSER_API_URL || "http://127.0.0.1:8000/parse";
    emitEvent({ type: "log", level: "info", message: `Calling OmniParser API at ${omniUrl}...` });

    // AUDIT-VIS-01 FIX: timeout thực tế là 90s (đủ cho YOLO+OCR chạy trên máy
    // yếu) nhưng thông báo lỗi cũ ghi cứng "20s" — sai lệch này từng khiến
    // việc debug độ trễ dễ hiểu lầm ("tưởng đã set 20s nhưng đợi hoài không
    // timeout"). Gộp về 1 hằng số duy nhất để không còn lệch nhau lần nữa.
    const PARSE_TIMEOUT_MS = 90000;
    const parseController = new AbortController();
    const parseTimeout = setTimeout(() => parseController.abort(), PARSE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(omniUrl, { method: "POST", body: formData, signal: parseController.signal });
    } catch (fetchErr) {
      if (fetchErr.name === "AbortError") throw new Error(`OmniParser API timed out after ${PARSE_TIMEOUT_MS / 1000}s`);
      throw fetchErr;
    } finally {
      clearTimeout(parseTimeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`OmniParser API error: ${response.status} ${response.statusText}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ""}`);
    }

    const result = await response.json();
    if (result.error) throw new Error(`OmniParser returned error: ${result.error}`);

    if (!result.target_center) {
      emitEvent({ type: "log", level: "info", message: `OmniParser could not find the target for: ${task}` });
      return { status: "failed", message: `Could not find target on screen for: ${task}` };
    }

    // 3. Move mouse and click by calling the persistent /click endpoint on the
    // same Python server (api_server.py) instead of spawning a brand-new Python
    // interpreter per click. This avoids the ~200-500ms cold-start + re-import
    // overhead of `spawn("python", ...)` on every single action.
    const [x, y] = result.target_center;
    emitEvent({ type: "log", level: "info", message: `Clicking target at ratio x:${x}, y:${y}` });

    const clickUrl = process.env.OMNIPARSER_CLICK_URL || "http://127.0.0.1:8000/click";
    const clickController = new AbortController();
    const clickTimeout = setTimeout(() => clickController.abort(), 10000);
    let clickResponse;
    try {
      clickResponse = await fetch(clickUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x_ratio: x, y_ratio: y }),
        signal: clickController.signal,
      });
    } catch (fetchErr) {
      if (fetchErr.name === "AbortError") throw new Error("Mouse click request timed out after 10s");
      throw fetchErr;
    } finally {
      clearTimeout(clickTimeout);
    }

    // IMPORTANT: we only report success after actually confirming the click
    // worked. Previously this function returned "clicked successfully" the
    // instant the child process was spawned, without checking whether
    // mouse_controller.py actually succeeded — a false positive if the click
    // failed (e.g. missing OS Accessibility permission).
    const clickResult = await clickResponse.json().catch(() => ({}));
    if (!clickResponse.ok || !clickResult.success) {
      throw new Error(`Mouse click failed: ${clickResult.error || clickResponse.statusText}`);
    }

    emitEvent({ type: "log", level: "info", message: `[MouseController] Clicked at (${clickResult.x}, ${clickResult.y})` });
    return { status: "success", message: `Found the target on screen and clicked it successfully for: ${task}` };

  } catch (err) {
    emitEvent({ type: "log", level: "error", message: `[OmniParser Error] ${err.message}` });
    return { status: "error", message: `Error performing computer task: ${err.message}` };
  }
}

export async function startComputerUseType(args) {
  const { text, key } = args || {};
  if (!text && !key) {
    return { status: "error", message: "Missing 'text' or 'key' to type." };
  }
  emitEvent({ type: "log", level: "info", message: `Typing - text: '${text}', key: '${key}'` });

  const typeUrl = process.env.OMNIPARSER_TYPE_URL || "http://127.0.0.1:8000/type";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(typeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, key }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      throw new Error(`Keyboard action failed: ${result.error || response.statusText}`);
    }
    emitEvent({ type: "log", level: "info", message: `[KeyboardController] Success` });
    return { status: "success", message: `Keyboard action successful.` };
  } catch (err) {
    emitEvent({ type: "log", level: "error", message: `[Keyboard Error] ${err.message}` });
    return { status: "error", message: `Error performing keyboard action: ${err.message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function submitLocalChat(args) {
  try {
    const { default: ollama } = await import("ollama");
    const localModel = process.env.IRIS_LOCAL_MODEL || "llama3";
    const response = await ollama.chat({
      model: localModel,
      messages: [{ role: "user", content: args.query }],
    });
    return {
      status: "success",
      local_ai_response: response.message.content,
      instructions: "Read the local_ai_response aloud to the user exactly as it is."
    };
  } catch (err) {
    emitEvent({ type: "log", level: "error", message: `Ollama error: ${err.message}` });
    return {
      status: "error",
      error: `Failed to reach local AI: ${err.message}. Tell the user local AI is down.`
    };
  }
}

// Protocol whitelist: only allow web-safe protocols via shell.openExternal.
// This prevents Gemini from being tricked (via prompt injection) into opening
// file://, javascript:, or arbitrary custom protocol handlers.
export const ALLOWED_URL_PROTOCOLS = new Set(["https:", "http:"]);

// Executable whitelist: Gemini may only launch apps in this set.
// Add entries here as needed. All matching is against the basename (lowercase),
// so path traversal attempts like "../../evil.exe" are automatically rejected.
export const ALLOWED_APP_EXECUTABLES = new Set([
  "calc.exe", "notepad.exe", "mspaint.exe", "explorer.exe", "taskmgr.exe",
  "control.exe", "winver.exe", "snippingtool.exe",
  "code.exe", "code - insiders.exe",
  "chrome.exe", "msedge.exe", "firefox.exe",
  "vlc.exe", "spotify.exe", "discord.exe", "slack.exe", "obsidian.exe",
]);

export async function openUrlOrApp(args) {
  const { target, is_url, force_new = false } = args;

  // --- URL branch ---
  if (is_url) {
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return { status: "error", error: "Invalid URL: could not parse the provided target as a URL." };
    }
    if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
      return {
        status: "error",
        error: `Protocol '${parsed.protocol}' is not allowed. Only https and http are permitted.`,
      };
    }
    try {
      // Use parsed.href so any encoding tricks in the original string are normalised first.
      await shell.openExternal(parsed.href);
      return { status: "success", message: `Opened URL: ${parsed.href}` };
    } catch (err) {
      return { status: "error", error: `Failed to open URL: ${err.message}` };
    }
  }

  // --- App branch ---
  // Strip any directory prefix so path-traversal attacks like "../../evil.exe"
  // collapse to just their basename before hitting the whitelist check.
  const basename = (target.split(/[\\/]/).pop() ?? "").toLowerCase().trim();
  if (!ALLOWED_APP_EXECUTABLES.has(basename)) {
    return {
      status: "error",
      error: `App '${basename}' is not in the allowed list. Ask the user to add it to ALLOWED_APP_EXECUTABLES in main.mjs if needed.`,
    };
  }

  // FIX (2026): "mở" ('open') used to ALWAYS spawn a brand new process,
  // even if the app was already running (just minimized/hidden in the
  // background) — so asking to "open" something you already had open just
  // launched a second, unrelated instance/window instead of bringing the
  // existing one back. Now, unless the caller explicitly asks for a new
  // instance (force_new — "mở mới"/"open a new one"), we first try to
  // restore+focus an already-running window of this app via
  // system_actions.py's restore action (which now also finds windows that
  // were hidden with hide_app, not just minimized ones). Only if nothing
  // is currently running do we fall through to actually spawning it.
  if (!force_new) {
    const restoreResult = await _runSystemActionPy("restore", [basename]);
    const restoreParsed = _resultFromSystemAction(restoreResult, "");
    if (restoreParsed.status === "success") {
      return { status: "success", message: `Restored the already-running ${basename} (${restoreParsed.message || ""}).`.trim(), reused_existing: true };
    }
    // Not running (or no window found) — fall through and launch it fresh.
  }

  try {
    // Use spawn with shell:false so args are passed as an array, never concatenated
    // into a shell string.  This eliminates the cmd-injection vector that exec()
    // with template-literal interpolation created (see DEP0190 warning).
    const child = spawn("cmd.exe", ["/c", "start", "", basename], {
      shell: false,   // CRITICAL — do NOT set to true
      detached: true, // App runs independently; Electron won't hold it alive
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return { status: "success", message: `Started ${force_new ? "a new instance of " : ""}application: ${basename}`, reused_existing: false };
  } catch (err) {
    return { status: "error", error: `Failed to start app: ${err.message}` };
  }
}

// -----------------------------------------------------------------------
// tools/system_actions.py bridge
//
// FIX (was a silent-failure bug): the previous implementation spawned
// system_actions.py with `detached: true, stdio: "ignore"` and returned
// "success" the instant the process was launched — the script's real
// stdout/stderr/exit-code were thrown away, so a failed close/minimize/
// restore/write (e.g. "No visible window found", access denied, taskkill
// error) was ALWAYS reported back to the AI/user as a success. These four
// actions are fast (a taskkill call or a EnumWindows pass), so we now
// await the process with a short timeout and surface its real outcome —
// same pattern as runPythonTool() in local-tools.mjs.
// -----------------------------------------------------------------------
function _runSystemActionPy(action, args, { timeoutMs = 8000 } = {}) {
  const pyPath = join(process.cwd(), "tools", "system_actions.py");
  const pythonBin = process.env.IRIS_PYTHON_BIN || "python";

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child?.kill(); } catch { /* ignore */ }
      resolve({ ok: false, error: `Timed out after ${timeoutMs}ms`, stdout: stdout.trim(), stderr: stderr.trim() });
    }, timeoutMs);

    try {
      child = spawn(pythonBin, [pyPath, action, ...args], { shell: false, windowsHide: action !== "note" });
    } catch (err) {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, stdout: "", stderr: "" });
      return;
    }

    child.stdout.on("data", (d) => { stdout += d.toString("utf-8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// Parses system_actions.py's one-line JSON stdout into the { status, ... }
// shape every tool here returns; falls back gracefully if it ever printed
// plain text (kept during the Python-side migration to JSON output).
function _resultFromSystemAction(result, failMsg) {
  if (!result.ok) {
    return { status: "error", error: result.error || result.stderr || result.stdout || failMsg };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return { status: parsed.success ? "success" : "error", ...parsed };
  } catch {
    return { status: "success", message: result.stdout || failMsg };
  }
}

export async function closeAppTool(args) {
  const { target } = args;
  if (!target) return { status: "error", error: "Missing 'target' executable name." };
  const basename = (target.split(/[\\/]/).pop() ?? "").toLowerCase().trim();
  const result = await _runSystemActionPy("close", [basename]);
  return _resultFromSystemAction(result, `Failed to close app: ${basename}`);
}

// FIX (2026): "hide" and "minimize" used to be the same action (minimize_app
// was documented as "invoke this for hide OR minimize"), so there was no way
// to tell Iris apart what the user actually meant, and a mis-picked close_app
// could even end up terminating the app when the user only asked to hide it.
// hide_app is now its own distinct primitive: it truly hides the window
// (gone from screen AND taskbar/Alt-Tab, but the process keeps running) via
// tools/system_actions.py's new "hide" action (SW_HIDE) — separate from
// minimizeAppTool below, which still just minimizes to the taskbar.
export async function hideAppTool(args) {
  const { target } = args;
  if (!target) return { status: "error", error: "Missing 'target' executable name." };
  const basename = (target.split(/[\\/]/).pop() ?? "").toLowerCase().trim();
  const result = await _runSystemActionPy("hide", [basename]);
  return _resultFromSystemAction(result, `Failed to hide app: ${basename}`);
}

export async function minimizeAppTool(args) {
  const { target } = args;
  if (!target) return { status: "error", error: "Missing 'target' executable name." };
  const basename = (target.split(/[\\/]/).pop() ?? "").toLowerCase().trim();
  const result = await _runSystemActionPy("minimize", [basename]);
  return _resultFromSystemAction(result, `Failed to minimize app: ${basename}`);
}

export async function restoreAppTool(args) {
  const { target } = args;
  if (!target) return { status: "error", error: "Missing 'target' executable name." };
  const basename = (target.split(/[\\/]/).pop() ?? "").toLowerCase().trim();
  const result = await _runSystemActionPy("restore", [basename]);
  return _resultFromSystemAction(result, `Failed to restore app: ${basename}`);
}

export async function writeNoteTool(args) {
  const { text, is_new } = args;
  if (!text) return { status: "error", error: "Missing 'text' argument." };
  const cmdArgs = [text];
  if (is_new) cmdArgs.push("--new");
  // Notepad needs to actually appear on screen, and typing/rendering can be
  // a little slower than the other actions, so give it more headroom.
  const result = await _runSystemActionPy("note", cmdArgs, { timeoutMs: 12000 });
  return _resultFromSystemAction(result, "Failed to write note.");
}

export function laneEventLogger(label) {
  return (event) => {
    if (event.status === "completed") {
      emitEvent({ type: "log", level: "info", message: `${label}: hoàn tất (${event.id}).` });
    } else if (event.status === "error") {
      emitEvent({ type: "log", level: "error", message: `${label}: lỗi (${event.id}) — ${event.error}` });
    }
  };
}

export async function getIrisStatusTool() {
  return {
    status: "success",
    actions: listActiveActions(),
    lanes: laneSnapshot(),
    silent_mode: silentMode,
  };
}

export async function getActionStatusTool(args = {}) {
  const { action_id } = args;
  if (!action_id) return { status: "error", error: "Thiếu action_id." };
  return getActionStatus(action_id);
}

export async function stopActionTool(args = {}) {
  const { action_id } = args;
  if (!action_id) return { status: "error", error: "Thiếu action_id." };
  const ok = cancelAction(action_id);
  return ok
    ? { status: "success", message: `Đã yêu cầu dừng hành động ${action_id}.` }
    : { status: "error", error: `Không tìm thấy hành động đang chạy: ${action_id}` };
}

// -----------------------------------------------------------------------
// Full computer-use sessions now go through the "computer" lane (limit 1)
// instead of a bare fire-and-forget call, so Iris can report progress and
// so a second "take over the computer" request while one is already
// running gets queued instead of fighting over the mouse.
// -----------------------------------------------------------------------
export async function startComputerUseTaskLaned(args) {
  const { task } = args || {};
  if (!task || !String(task).trim()) {
    return { status: "error", message: "Thiếu 'task' để điều khiển máy tính." };
  }
  const submitted = submitAction({
    lane: "computer",
    label: `Computer use: ${task}`,
    fn: (actionId) =>
      runComputerSession(
        task,
        (streamEvent) => {
          if (streamEvent.text) {
            emitEvent({ type: "log", level: "info", message: `[ComputerUse] ${streamEvent.text}` });
          }
        },
        // fn() may start running before submitAction() below has returned
        // (see action-lane.mjs), so this closure must use the actionId
        // parameter rather than close over the outer `submitted` variable.
        () => isCancelled(actionId),
      ),
    onEvent: laneEventLogger("Computer use"),
  });
  const message =
    submitted.status === "started"
      ? "Đã bắt đầu điều khiển máy tính, đang chạy nền."
      : "Một phiên điều khiển máy tính khác đang chạy — lệnh này đã được xếp hàng và sẽ tự chạy tiếp theo.";
  return { ...submitted, message };
}

// -----------------------------------------------------------------------
// Browser agent (feature: trình duyệt tự hành) — direct Playwright actions.
// These are quick (sub-few-second) DOM operations, so — like
// computer_use_type / computer_use_omniparser — they are awaited and their
// real result (extracted text, click confirmation, etc.) is returned
// straight to Gemini, not just a "started" ack. The "browser" lane still
// caps concurrency so two calls can't drive the same page at once.
// -----------------------------------------------------------------------
export function runBrowserAction(fn, label) {
  return async (args) => {
    const submitted = submitAction({
      lane: "browser",
      label,
      fn: () => fn(args || {}),
      onEvent: laneEventLogger(label),
    });
    // Poll the lane's own record for completion instead of a second promise
    // chain — keeps a single source of truth for the action's result.
    while (true) {
      const record = getActionStatus(submitted.id);
      if (record.status === "completed") return record.result;
      if (record.status === "error") return { status: "error", error: record.error };
      if (record.status === "cancelled") return { status: "error", error: "Đã huỷ hành động này trước khi chạy." };
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  };
}

export const browserOpenTool = runBrowserAction(browserAgent.browserOpen, "Mở trang web");
export const browserClickTool = runBrowserAction(browserAgent.browserClick, "Click trong trình duyệt");
export const browserTypeTool = runBrowserAction(browserAgent.browserType, "Nhập văn bản trong trình duyệt");
export const browserExtractTextTool = runBrowserAction(browserAgent.browserExtractText, "Đọc nội dung trang");
export const browserScreenshotTool = runBrowserAction(browserAgent.browserScreenshot, "Chụp màn hình trình duyệt");
export const browserCloseTool = runBrowserAction(browserAgent.browserClose, "Đóng trình duyệt");

export function setSilentModeTool({ enabled } = {}) {
  silentMode = Boolean(enabled);
  emitToRenderer("iris:silent-mode", { enabled: silentMode });
  return {
    status: "success",
    silent_mode: silentMode,
    message: silentMode
      ? "Đã bật chế độ im lặng — Iris vẫn nghe và trả lời bằng chữ, nhưng không phát ra tiếng."
      : "Đã tắt chế độ im lặng — Iris nói bình thường trở lại.",
  };
}

// External writer: main.mjs's "iris:ui-context" ipc.on handler updates this
// (originally a direct `irisUiContext = context;` assignment in the same
// file; now routed through a setter since irisUiContext lives here).
export function setUiContext(context) {
  irisUiContext = context;
}
