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

import { toolsDir, pythonBin, userDataDir } from "./paths.mjs";

// P-01: đường dẫn/Python tính theo mỗi lời gọi (không chốt lúc nạp module).

/**
 * Runs `python tools/<script> ...args`, capturing combined stdout/stderr.
 * Resolves (never rejects) with { ok, code, stdout, stderr, error? } so
 * callers can always turn the result into a clean tool response for Gemini.
 */
// G-08: các script dưới đây dùng ctypes.windll / WMI / PowerShell / netsh... => chỉ chạy được trên Windows.
// Báo lỗi rõ ràng ở phía Node thay vì để Python văng traceback khó hiểu trên macOS/Linux.
export const WINDOWS_ONLY_TOOLS = new Set([
  "active_window_info.py", "desktop_manager.py", "focus_assist.py", "idle_time.py", "lock_screen.py",
  "magic_move.py", "move_window.py", "multi_monitor_info.py", "power_manager.py", "read_notifications.py",
  "search_everything.py", "sys_control.py", "system_actions.py", "wifi_manager.py",
]);

function runPythonTool(script, args = [], { timeoutMs = 20000, detach = false } = {}) {
  if (process.platform !== "win32" && WINDOWS_ONLY_TOOLS.has(script)) {
    return Promise.resolve({
      ok: false,
      stdout: "",
      stderr: "",
      error: `Công cụ ${script} chỉ hỗ trợ Windows (hệ điều hành hiện tại: ${process.platform}).`,
    });
  }
  const pyPath = join(toolsDir(), script);

  if (detach) {
    // Fire-and-forget for scripts that block on human interaction (e.g.
    // magic_move.py --active counts down 5s waiting for a click) — we must
    // not hold the Gemini Live turn open for that.
    try {
      const child = spawn(pythonBin(), [pyPath, ...args], {
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
      child = spawn(pythonBin(), [pyPath, ...args], { shell: false, windowsHide: true });
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
  // V-15: ảnh nằm ở <userData>/screenshots (không còn ghi vào tools/ trong repo).
  const outDir = join(userDataDir(), "screenshots");
  const result = await runPythonTool("ai_vision.py", ["--outdir", outDir], { timeoutMs: 15000 });
  if (!result.ok) {
    return { status: "error", error: result.error || result.stderr || "ai_vision.py failed." };
  }
  const match = result.stdout.match(/^SCREENSHOT_PATH=(.+)$/m);
  const screenshotPath = match ? match[1].trim() : null;
  if (!screenshotPath) {
    return { status: "error", error: `Could not parse screenshot path from output: ${result.stdout}` };
  }
  // Gửi ảnh vào phiên live để Gemini "nhìn" được. Import trễ vì gemini-live.mjs import
  // tool dispatcher (vòng tròn nếu import tĩnh).
  try {
    const fs = await import("node:fs/promises");
    const { sendVideoFrame } = await import("./gemini-live.mjs");
    const buffer = await fs.readFile(screenshotPath);
    // mimeType tự nhận từ nội dung (JPEG) — không còn gắn nhãn jpeg cho file PNG.
    if (!sendVideoFrame(buffer.toString("base64"))) {
      return {
        status: "error",
        screenshot_path: screenshotPath,
        error: "Đã chụp màn hình nhưng KHÔNG gửi được ảnh lên Gemini (chưa có phiên Live hoặc ảnh không hợp lệ).",
      };
    }
  } catch (err) {
    return {
      status: "error",
      screenshot_path: screenshotPath,
      error: `Đã chụp màn hình nhưng không thể gửi ảnh cho Gemini: ${err.message}`,
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
// window-magic (precise mode) -> tools/move_window.py
// -----------------------------------------------------------------------
export async function moveWindowPreciseTool(args = {}) {
  const { name, x = 0, y = 0, width, height } = args;
  if (!name) return { status: "error", error: "Missing 'name' — which window should be moved?" };
  
  const cliArgs = [name, String(x), String(y)];
  if (width !== undefined) {
      cliArgs.push("--width", String(width));
  }
  if (height !== undefined) {
      cliArgs.push("--height", String(height));
  }
  
  const result = await runPythonTool("move_window.py", cliArgs, { timeoutMs: 10000 });
  if (!result.ok) return { status: "error", error: result.error || result.stderr || "move_window.py failed." };
  return { status: "success", message: result.stdout };
}

// -----------------------------------------------------------------------
// power management skill -> tools/power_manager.py
// -----------------------------------------------------------------------
export async function powerManagerTool(action) {
  if (!action) return { status: "error", error: "Missing 'action' (sleep, shutdown, restart)." };
  return _runJsonTool("power_manager.py", [action], { timeoutMs: 10000 }, "power_manager.py failed.");
}

// -----------------------------------------------------------------------
// media control skill -> tools/media_control.py
// -----------------------------------------------------------------------
export async function mediaControlTool(action) {
  if (!action) return { status: "error", error: "Missing 'action' (playpause, next, prev)." };
  return _runJsonTool("media_control.py", [action], { timeoutMs: 8000 }, "media_control.py failed.");
}

// -----------------------------------------------------------------------
// desktop manager skill -> tools/desktop_manager.py
// -----------------------------------------------------------------------
export async function desktopManagerTool(action) {
  if (!action) return { status: "error", error: "Missing 'action' (new, close, left, right, boss)." };
  return _runJsonTool("desktop_manager.py", [action], { timeoutMs: 8000 }, "desktop_manager.py failed.");
}

// -----------------------------------------------------------------------
// search_everything skill -> tools/search_everything.py
// -----------------------------------------------------------------------
export async function searchEverythingTool(args = {}) {
  const { query, max = 10 } = args;
  if (!query) return { status: "error", error: "Missing query parameter." };
  
  const result = await runPythonTool("search_everything.py", [query, "--max", String(max)], { timeoutMs: 10000 });
  if (!result.ok) {
    return { status: "error", output: result.stdout || result.stderr || result.error };
  }
  
  try {
    const data = JSON.parse(result.stdout);
    if (!data.success) {
      return { status: "error", error: data.error };
    }
    return { status: "success", query: data.query, results: data.results, count: data.results.length };
  } catch (err) {
    return { status: "error", output: result.stdout, error: "Failed to parse JSON" };
  }
}

// -----------------------------------------------------------------------
// read_notifications skill -> tools/read_notifications.py
// -----------------------------------------------------------------------
export async function readNotificationsTool(args = {}) {
  const { limit = 5 } = args;
  const result = await runPythonTool("read_notifications.py", ["--limit", String(limit)], { timeoutMs: 10000 });
  if (!result.ok) {
    return { status: "error", output: result.stdout || result.stderr || result.error };
  }
  
  try {
    const data = JSON.parse(result.stdout);
    if (!data.success) {
      return { status: "error", error: data.error };
    }
    return { status: "success", notifications: data.notifications };
  } catch (err) {
    return { status: "error", output: result.stdout, error: "Failed to parse JSON" };
  }
}
