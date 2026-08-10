/**
 * electron/main/local-tools.mjs
 *
 * Wraps the standalone Python scripts in tools/ (originally written as
 * Claude-Code "skills" under .agents/skills) so Gemini Live can call them
 * DIRECTLY as function-calling tools, without going through submit_claude_task.
 * This is the fast/parallel-lane equivalent of the ai-vision, clipboard,
 * window-magic, notify, sys-control and sys-monitor skills.
 *
 * Every helper here spawns `python tools/<script>.py <args>`, captures
 * stdout/stderr, and resolves once the process exits (or the timeout fires).
 * None of these hold the mic hostage for more than a few seconds, so — unlike
 * start_computer_use_task — they are all awaited and return their real
 * result straight to Gemini instead of just a "started" ack.
 *
 * tools/move_window.py is intentionally NOT wired here: it has no matching
 * .agents/skills SKILL.md entry and duplicates tools/magic_move.py (which
 * IS documented as the window-magic skill), so magic_move.py is the one
 * exposed as move_window_magic below.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const TOOLS_DIR = join(process.cwd(), "tools");
const PYTHON_BIN = process.env.IRIS_PYTHON_BIN || "python";

/**
 * Runs `python tools/<script> ...args`, capturing combined stdout/stderr.
 * Resolves (never rejects) with { ok, code, stdout, stderr, error? } so
 * callers can always turn the result into a clean tool response for Gemini.
 */
function runPythonTool(script, args = [], { timeoutMs = 20000, detach = false } = {}) {
  const pyPath = join(TOOLS_DIR, script);

  if (detach) {
    // Fire-and-forget for scripts that block on human interaction (e.g.
    // magic_move.py --active counts down 5s waiting for a click) — we must
    // not hold the Gemini Live turn open for that.
    try {
      const child = spawn(PYTHON_BIN, [pyPath, ...args], {
        shell: false,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return Promise.resolve({ ok: true, detached: true, stdout: "", stderr: "" });
    } catch (err) {
      return Promise.resolve({ ok: false, detached: true, error: err.message, stdout: "", stderr: "" });
    }
  }

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
      child = spawn(PYTHON_BIN, [pyPath, ...args], { shell: false, windowsHide: true });
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

// -----------------------------------------------------------------------
// ai-vision skill -> tools/ai_vision.py
// -----------------------------------------------------------------------
export async function takeAiScreenshotTool() {
  const result = await runPythonTool("ai_vision.py", ["--outdir", TOOLS_DIR], { timeoutMs: 15000 });
  if (!result.ok) {
    return { status: "error", error: result.error || result.stderr || "ai_vision.py failed." };
  }
  // ai_vision.py now prints one line of JSON: {success, message, screenshot_path}
  // (it used to print free-form Vietnamese text that we had to regex out of —
  // any wording change there silently broke this parse).
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { status: "error", error: `Could not parse ai_vision.py output as JSON: ${result.stdout}` };
  }
  if (!parsed.success || !parsed.screenshot_path) {
    return { status: "error", error: parsed.error || "ai_vision.py did not return a screenshot_path." };
  }
  const screenshotPath = parsed.screenshot_path;
  // Feed the screenshot straight into the live session as a frame so Gemini
  // can literally look at it — same path sendFrameToGemini already uses for
  // camera/companion frames. Deferred import: gemini-live.mjs imports the
  // tool dispatcher (which imports this file), so importing it back at the
  // top of this file would be circular; importing lazily inside the call
  // (after both modules have finished evaluating) sidesteps that safely.
  try {
    const fs = await import("node:fs/promises");
    const { sendFrameToGemini } = await import("./gemini-live.mjs");
    const buffer = await fs.readFile(screenshotPath);
    sendFrameToGemini(buffer.toString("base64"));
  } catch (err) {
    return {
      status: "success",
      screenshot_path: screenshotPath,
      warning: `Screenshot saved but could not be streamed to you automatically: ${err.message}`,
    };
  }
  return {
    status: "success",
    screenshot_path: screenshotPath,
    instructions: "The screenshot has just been sent to you as an image frame — describe what you see on the screen to the user now.",
  };
}

// -----------------------------------------------------------------------
// clipboard skill -> tools/clipboard_manager.py
// -----------------------------------------------------------------------
export async function readClipboardTool() {
  const result = await runPythonTool("clipboard_manager.py", ["--action", "read"], { timeoutMs: 10000 });
  if (!result.ok) return { status: "error", error: result.error || result.stderr || "clipboard_manager.py failed." };
  return { status: "success", clipboard_text: result.stdout };
}

export async function writeClipboardTool(args = {}) {
  const { text } = args;
  if (!text) return { status: "error", error: "Missing 'text' to write to clipboard." };
  const result = await runPythonTool("clipboard_manager.py", ["--action", "write", "--text", text], { timeoutMs: 10000 });
  if (!result.ok) return { status: "error", error: result.error || result.stderr || "clipboard_manager.py failed." };
  return { status: "success", message: result.stdout || `Copied ${text.length} characters to the clipboard.` };
}

// -----------------------------------------------------------------------
// window-magic skill -> tools/magic_move.py
// -----------------------------------------------------------------------
export async function moveWindowMagicTool(args = {}) {
  const { mode = "active", name, x = 0, y = 0 } = args;

  if (mode === "active") {
    // Blocks ~5s waiting for the user to click a window — never await this
    // on the live session; fire-and-forget and tell Gemini what to say.
    const result = await runPythonTool("magic_move.py", ["--active", "-x", String(x), "-y", String(y)], { detach: true });
    return {
      status: result.ok ? "started" : "error",
      error: result.ok ? undefined : result.error,
      instructions: "Tell the user right now: they have 5 seconds to click the window they want to move.",
    };
  }

  if (mode === "demo") {
    const demoArgs = ["--demo"];
    if (name) demoArgs.push("--name", name);
    const result = await runPythonTool("magic_move.py", demoArgs, { timeoutMs: 15000 });
    return _resultFromMagicMove(result, "magic_move.py --demo failed.");
  }

  if (mode === "demo2") {
    // Opens 6 Notepad windows and lines them up in a grid — previously
    // CLI-only per magic_move.py's docstring, but nothing actually blocked
    // it; this branch was just missing. Needs longer than the plain demo
    // since it spawns and waits on 6 real processes.
    const result = await runPythonTool("magic_move.py", ["--demo2"], { timeoutMs: 25000 });
    return _resultFromMagicMove(result, "magic_move.py --demo2 failed.");
  }

  // mode === "name"
  if (!name) return { status: "error", error: "Missing 'name' — which window should be moved?" };
  const result = await runPythonTool("magic_move.py", ["--name", name, "-x", String(x), "-y", String(y)], { timeoutMs: 10000 });
  return _resultFromMagicMove(result, "magic_move.py --name failed.");
}

// magic_move.py now prints one line of JSON (like every other tool here)
// instead of free-form Vietnamese text — parse it instead of dumping the
// raw JSON string into `message`.
function _resultFromMagicMove(result, failMsg) {
  if (!result.ok) return { status: "error", error: result.error || result.stderr || failMsg };
  try {
    const parsed = JSON.parse(result.stdout);
    return { status: parsed.success ? "success" : "error", ...parsed };
  } catch {
    return { status: "success", message: result.stdout };
  }
}

// -----------------------------------------------------------------------
// notify skill -> tools/notifier.py
// -----------------------------------------------------------------------
export async function sendDesktopNotificationTool(args = {}) {
  const { title, message } = args;
  if (!title || !message) return { status: "error", error: "Missing 'title' or 'message' for the notification." };
  const result = await runPythonTool("notifier.py", ["--title", title, "--message", message], { timeoutMs: 10000 });
  if (!result.ok) return { status: "error", error: result.error || result.stderr || "notifier.py failed." };
  return { status: "success", message: result.stdout || `Notification sent: ${title}` };
}

// -----------------------------------------------------------------------
// sys-control skill -> tools/sys_control.py
// -----------------------------------------------------------------------
// FIX (2026): "volume" used to only accept mute/up/down, and "mute" itself
// was just a raw VK_VOLUME_MUTE key TOGGLE (not a deterministic set-state)
// — so there was no reliable way to unmute, even though the AI prompt
// (gemini-live.mjs) explicitly told it "mute/unmute" was supported. Now
// forwards "unmute" and "set" (with volumeLevel) straight through to
// sys_control.py, which handles them deterministically via pycaw.
export async function systemControlTool(args = {}) {
  const { volume, volumeLevel, brightness, wifi, bluetooth, camera } = args;
  const cliArgs = [];
  if (volume) {
    if (volume === "set") {
      if (volumeLevel === undefined || volumeLevel === null) {
        return { status: "error", error: "'volumeLevel' (0-100) is required when volume is 'set'." };
      }
      cliArgs.push("--volume", "set", "--volume-level", String(volumeLevel));
    } else {
      cliArgs.push("--volume", volume);
    }
  }
  if (brightness !== undefined && brightness !== null) cliArgs.push("--brightness", String(brightness));
  if (wifi) cliArgs.push("--wifi", wifi);
  if (bluetooth) cliArgs.push("--bluetooth", bluetooth);
  if (camera) cliArgs.push("--camera", camera);

  if (!cliArgs.length) {
    return { status: "error", error: "Specify at least one of: volume, brightness, wifi, bluetooth, camera." };
  }

  // sys_control.py's own subprocess.run(Start-Process ... -Verb RunAs) does
  // NOT pass -Wait, so the script returns as soon as the UAC prompt is
  // triggered rather than blocking until the user answers it — safe to await.
  //
  // sys_control.py exits 1 whenever ANY requested sub-action failed (e.g.
  // volume worked but wifi didn't), so we must still parse stdout as JSON
  // in the failure case instead of discarding it — otherwise a partial
  // success would be reported as a total, undifferentiated error.
  const result = await runPythonTool("sys_control.py", cliArgs, { timeoutMs: 15000 });
  const needsUac = wifi || bluetooth || camera;
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch { /* not JSON — fall through */ }

  if (!parsed) {
    if (!result.ok) return { status: "error", error: result.error || result.stderr || "sys_control.py failed." };
    return { status: "success", message: result.stdout };
  }
  return {
    status: parsed.success ? "success" : "error",
    results: parsed.results,
    error: parsed.success ? undefined : (parsed.error || "One or more system_control actions failed — see 'results' for details."),
    instructions: needsUac
      ? "If a UAC (administrator) prompt appears on screen, tell the user right now to click 'Yes' for the action to take effect."
      : undefined,
  };
}

// -----------------------------------------------------------------------
// mouse-control skill -> tools/mouse_control.py
// -----------------------------------------------------------------------
export async function mouseControlTool(args = {}) {
  const { action, x, y, x2, y2, button = "left", double = false, amount, click = false, linear = false } = args;
  if (!action) return { status: "error", error: "Missing 'action' (move, click, drag, scroll, position)." };

  const cliArgs = [action];
  if (action === "move" || action === "click") {
    if (x === undefined || y === undefined) return { status: "error", error: "'x' and 'y' are required for move/click." };
    cliArgs.push(String(x), String(y));
    if (linear) cliArgs.push("--linear");
    if (action === "click") {
      cliArgs.push("--button", button);
      if (double) cliArgs.push("--double");
    } else if (action === "move" && click) {
      // Cho phep move gop luon click, khong can goi rieng action "click".
      cliArgs.push("--click", "--button", button);
      if (double) cliArgs.push("--double");
    }
  } else if (action === "drag") {
    if ([x, y, x2, y2].some((v) => v === undefined)) {
      return { status: "error", error: "'x', 'y', 'x2', 'y2' are all required for drag." };
    }
    cliArgs.push(String(x), String(y), String(x2), String(y2), "--button", button);
  } else if (action === "scroll") {
    if (amount === undefined) return { status: "error", error: "'amount' is required for scroll (positive = up, negative = down)." };
    cliArgs.push(String(amount));
  } else if (action !== "position") {
    return { status: "error", error: `Unknown action '${action}'. Use: move, click, drag, scroll, position.` };
  }

  const result = await runPythonTool("mouse_control.py", cliArgs, { timeoutMs: 10000 });
  if (!result.ok) return { status: "error", error: result.error || result.stderr || "mouse_control.py failed." };
  try {
    return { status: "success", ...JSON.parse(result.stdout) };
  } catch {
    return { status: "success", raw_output: result.stdout };
  }
}

// -----------------------------------------------------------------------
// sys-monitor skill -> tools/sys_monitor.py
// -----------------------------------------------------------------------
export async function systemMonitorTool() {
  // The script itself samples CPU over 1s (psutil.cpu_percent(interval=1)).
  const result = await runPythonTool("sys_monitor.py", [], { timeoutMs: 15000 });
  if (!result.ok) return { status: "error", error: result.error || result.stderr || "sys_monitor.py failed." };
  try {
    const health = JSON.parse(result.stdout);
    return { status: "success", health, instructions: "Summarize this system health data for the user in plain, friendly language. Warn them if RAM, disk, or CPU is over ~90%, or battery is low and unplugged." };
  } catch {
    return { status: "success", raw_output: result.stdout };
  }
}

// Small shared helper: run a script, parse its one-line JSON stdout, and
// normalize into the { status, ... } shape every tool here returns.
async function _runJsonTool(script, args, opts, failMsg) {
  const result = await runPythonTool(script, args, opts);
  if (!result.ok) return { status: "error", error: result.error || result.stderr || failMsg };
  try {
    return { status: "success", ...JSON.parse(result.stdout) };
  } catch {
    return { status: "success", raw_output: result.stdout };
  }
}

// -----------------------------------------------------------------------
// context skill -> tools/active_window_info.py
// -----------------------------------------------------------------------
export async function activeWindowInfoTool() {
  return _runJsonTool("active_window_info.py", [], { timeoutMs: 8000 }, "active_window_info.py failed.");
}

// -----------------------------------------------------------------------
// context skill -> tools/ocr_region.py
// -----------------------------------------------------------------------
export async function ocrRegionTool(args = {}) {
  const { left, top, width, height, lang = "eng" } = args;
  const cliArgs = [];
  if ([left, top, width, height].every((v) => v !== undefined)) {
    cliArgs.push("--region", String(left), String(top), String(width), String(height));
  }
  cliArgs.push("--lang", lang);
  return _runJsonTool("ocr_region.py", cliArgs, { timeoutMs: 15000 }, "ocr_region.py failed.");
}

// -----------------------------------------------------------------------
// context skill -> tools/color_picker.py
// -----------------------------------------------------------------------
export async function colorPickerTool(args = {}) {
  const { x, y } = args;
  const cliArgs = x !== undefined && y !== undefined ? [String(x), String(y)] : [];
  return _runJsonTool("color_picker.py", cliArgs, { timeoutMs: 8000 }, "color_picker.py failed.");
}

// -----------------------------------------------------------------------
// context skill -> tools/idle_time.py
// -----------------------------------------------------------------------
export async function idleTimeTool() {
  return _runJsonTool("idle_time.py", [], { timeoutMs: 8000 }, "idle_time.py failed.");
}

// -----------------------------------------------------------------------
// office skill -> tools/clipboard_history.py
// -----------------------------------------------------------------------
export async function clipboardHistoryTool(args = {}) {
  const { action, limit = 10, index } = args;
  if (!action) return { status: "error", error: "Missing 'action' (watch, stop, list, use, clear)." };

  if (action === "watch") {
    const result = await runPythonTool("clipboard_history.py", ["watch"], { detach: true });
    return { status: result.ok ? "success" : "error", error: result.ok ? undefined : result.error, message: "Started watching the clipboard in the background." };
  }
  if (action === "stop") return _runJsonTool("clipboard_history.py", ["stop"], { timeoutMs: 8000 }, "clipboard_history.py stop failed.");
  if (action === "list") return _runJsonTool("clipboard_history.py", ["list", "--limit", String(limit)], { timeoutMs: 8000 }, "clipboard_history.py list failed.");
  if (action === "use") {
    if (index === undefined) return { status: "error", error: "'index' is required for action 'use'." };
    return _runJsonTool("clipboard_history.py", ["use", String(index)], { timeoutMs: 8000 }, "clipboard_history.py use failed.");
  }
  if (action === "clear") return _runJsonTool("clipboard_history.py", ["clear"], { timeoutMs: 8000 }, "clipboard_history.py clear failed.");
  return { status: "error", error: `Unknown action '${action}'. Use: watch, stop, list, use, clear.` };
}

// -----------------------------------------------------------------------
// office skill -> tools/quick_reminder.py
// -----------------------------------------------------------------------
export async function quickReminderTool(args = {}) {
  const { action, minutes, title, message, id } = args;
  if (!action) return { status: "error", error: "Missing 'action' (schedule, list, cancel)." };

  if (action === "schedule") {
    if (!minutes || !title || !message) return { status: "error", error: "'minutes', 'title', and 'message' are required to schedule a reminder." };
    return _runJsonTool(
      "quick_reminder.py",
      ["schedule", "--minutes", String(minutes), "--title", title, "--message", message],
      { timeoutMs: 8000 },
      "quick_reminder.py schedule failed."
    );
  }
  if (action === "list") return _runJsonTool("quick_reminder.py", ["list"], { timeoutMs: 8000 }, "quick_reminder.py list failed.");
  if (action === "cancel") {
    if (!id) return { status: "error", error: "'id' is required for action 'cancel'." };
    return _runJsonTool("quick_reminder.py", ["cancel", id], { timeoutMs: 8000 }, "quick_reminder.py cancel failed.");
  }
  return { status: "error", error: `Unknown action '${action}'. Use: schedule, list, cancel.` };
}

// -----------------------------------------------------------------------
// office skill -> tools/tts_speak.py
// -----------------------------------------------------------------------
export async function ttsSpeakTool(args = {}) {
  const { text, rate, volume, voiceId, listVoices = false } = args;
  const cliArgs = [];
  if (listVoices) {
    cliArgs.push("--list-voices");
  } else {
    if (!text) return { status: "error", error: "Missing 'text' to speak (or set listVoices=true)." };
    cliArgs.push(text);
    if (rate !== undefined) cliArgs.push("--rate", String(rate));
    if (volume !== undefined) cliArgs.push("--volume", String(volume));
    if (voiceId) cliArgs.push("--voice-id", voiceId);
  }
  // Speaking blocks until the audio finishes playing — give long text room to run.
  const estMs = listVoices ? 8000 : Math.max(10000, (text?.length || 0) * 120);
  return _runJsonTool("tts_speak.py", cliArgs, { timeoutMs: estMs }, "tts_speak.py failed.");
}

// -----------------------------------------------------------------------
// network skill -> tools/wifi_manager.py
// -----------------------------------------------------------------------
export async function wifiManagerTool(args = {}) {
  const { action, ssid } = args;
  if (!action) return { status: "error", error: "Missing 'action' (list, profiles, connect, disconnect, status)." };
  if (action === "connect") {
    if (!ssid) return { status: "error", error: "'ssid' is required for action 'connect'." };
    return _runJsonTool("wifi_manager.py", ["connect", ssid], { timeoutMs: 15000 }, "wifi_manager.py connect failed.");
  }
  if (["list", "profiles", "disconnect", "status"].includes(action)) {
    return _runJsonTool("wifi_manager.py", [action], { timeoutMs: 15000 }, `wifi_manager.py ${action} failed.`);
  }
  return { status: "error", error: `Unknown action '${action}'. Use: list, profiles, connect, disconnect, status.` };
}

// -----------------------------------------------------------------------
// network skill -> tools/multi_monitor_info.py
// -----------------------------------------------------------------------
export async function multiMonitorInfoTool() {
  return _runJsonTool("multi_monitor_info.py", [], { timeoutMs: 8000 }, "multi_monitor_info.py failed.");
}

// -----------------------------------------------------------------------
// system-control-extended skill -> tools/process_manager.py
// -----------------------------------------------------------------------
export async function processManagerTool(args = {}) {
  const { action, sort = "ram", top = 10, name } = args;
  if (!action) return { status: "error", error: "Missing 'action' (list, kill)." };
  if (action === "list") {
    return _runJsonTool("process_manager.py", ["list", "--sort", sort, "--top", String(top)], { timeoutMs: 10000 }, "process_manager.py list failed.");
  }
  if (action === "kill") {
    if (!name) return { status: "error", error: "'name' is required for action 'kill' (e.g. 'chrome.exe')." };
    return _runJsonTool("process_manager.py", ["kill", name], { timeoutMs: 10000 }, "process_manager.py kill failed.");
  }
  return { status: "error", error: `Unknown action '${action}'. Use: list, kill.` };
}

// -----------------------------------------------------------------------
// system-control-extended skill -> tools/power_plan.py
// -----------------------------------------------------------------------
export async function powerPlanTool(args = {}) {
  const { action, name } = args;
  if (action === "get") return _runJsonTool("power_plan.py", ["get"], { timeoutMs: 8000 }, "power_plan.py get failed.");
  if (action === "set") {
    if (!name) return { status: "error", error: "'name' is required for action 'set' (balanced, saver, performance)." };
    return _runJsonTool("power_plan.py", ["set", name], { timeoutMs: 8000 }, "power_plan.py set failed.");
  }
  return { status: "error", error: "Missing/invalid 'action' (get, set)." };
}

// -----------------------------------------------------------------------
// system-control-extended skill -> tools/focus_assist.py
// -----------------------------------------------------------------------
export async function focusAssistTool() {
  // No official Windows API to silently toggle Focus Assist — this just
  // opens the real Settings page (ms-settings:quiethours) for the user.
  return _runJsonTool("focus_assist.py", ["open"], { timeoutMs: 8000 }, "focus_assist.py failed.");
}

// -----------------------------------------------------------------------
// system-control-extended skill -> tools/lock_screen.py
// -----------------------------------------------------------------------
export async function lockScreenTool() {
  return _runJsonTool("lock_screen.py", [], { timeoutMs: 8000 }, "lock_screen.py failed.");
}

// -----------------------------------------------------------------------
// image viewer skill -> tools/image_viewer.py
// -----------------------------------------------------------------------
export async function viewImageTool(args) {
  if (!args || !args.action) {
    return { status: "error", error: "Missing 'action' parameter." };
  }
  return _runJsonTool("image_viewer.py", ["--action", args.action], { timeoutMs: 5000 }, "image_viewer.py failed.");
}

// -----------------------------------------------------------------------
// video player skill -> tools/video_player.py
// -----------------------------------------------------------------------
export async function viewVideoTool(args) {
  if (!args || !args.action) {
    return { status: "error", error: "Missing 'action' parameter." };
  }
  return _runJsonTool("video_player.py", ["--action", args.action], { timeoutMs: 5000 }, "video_player.py failed.");
}

// -----------------------------------------------------------------------
// screen recorder skill -> tools/screen_recorder.py
// -----------------------------------------------------------------------
// FIX (2026): previously only start/stop/status were ever sent here, so
// there was no way to mute/unmute the mic or pause/resume a recording
// except by clicking the tiny always-on-top overlay buttons by hand.
// screen_recorder.py now understands pause/resume/mic_on/mic_off as
// real CLI actions (sent to the running daemon via its CMD_FILE), so we
// just need to let them through here too.
const RECORD_SCREEN_ACTIONS = ["start", "stop", "status", "pause", "resume", "mic_on", "mic_off"];

export async function recordScreenTool(args) {
  if (!args || !args.action) {
    return { status: "error", error: "Missing 'action' parameter." };
  }
  if (!RECORD_SCREEN_ACTIONS.includes(args.action)) {
    return { status: "error", error: `Unknown action '${args.action}'. Use: ${RECORD_SCREEN_ACTIONS.join(", ")}.` };
  }
  const pythonArgs = ["--action", args.action];
  if (args.window) {
    pythonArgs.push("--window", args.window);
  }
  // 'stop' can take a while: it waits for ffmpeg to mux system+mic audio
  // into the final mp4 (screen_recorder.py itself polls for up to 30s).
  const timeoutMs = args.action === "stop" ? 35000 : 10000;
  return _runJsonTool("screen_recorder.py", pythonArgs, { timeoutMs }, "screen_recorder.py failed.");
}
