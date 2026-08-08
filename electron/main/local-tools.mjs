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
  // ai_vision.py prints: "Thành công! Ảnh màn hình đã được lưu tại: <path>"
  const match = result.stdout.match(/l(?:ư|u)u t(?:ạ|a)i:\s*(.+)$/im) || result.stdout.match(/:\s*([A-Za-z]:\\.+\.png|\/.+\.png)/);
  const screenshotPath = match ? match[1].trim() : null;
  if (!screenshotPath) {
    return { status: "error", error: `Could not parse screenshot path from output: ${result.stdout}` };
  }
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
    if (!result.ok) return { status: "error", error: result.error || result.stderr || "magic_move.py failed." };
    return { status: "success", message: result.stdout };
  }

  // mode === "name"
  if (!name) return { status: "error", error: "Missing 'name' — which window should be moved?" };
  const result = await runPythonTool("magic_move.py", ["--name", name, "-x", String(x), "-y", String(y)], { timeoutMs: 10000 });
  if (!result.ok) return { status: "error", error: result.error || result.stderr || "magic_move.py failed." };
  return { status: "success", message: result.stdout };
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
export async function systemControlTool(args = {}) {
  const { volume, brightness, wifi, bluetooth, camera } = args;
  const cliArgs = [];
  if (volume) cliArgs.push("--volume", volume);
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
  const result = await runPythonTool("sys_control.py", cliArgs, { timeoutMs: 15000 });
  if (!result.ok) return { status: "error", error: result.error || result.stderr || "sys_control.py failed." };
  const needsUac = wifi || bluetooth || camera;
  return {
    status: "success",
    message: result.stdout,
    instructions: needsUac
      ? "If a UAC (administrator) prompt appears on screen, tell the user right now to click 'Yes' for the action to take effect."
      : undefined,
  };
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
