/**
 * electron/main/local-tools.mjs
 *
 * Bọc các script Python trong tools/ để Gemini Live gọi TRỰC TIẾP như function-calling tool (không qua
 * submit_claude_task). Mỗi hàm spawn `python tools/<script> <args>`, thu stdout/stderr, rồi chuyển thành
 * MỘT schema kết quả duy nhất `{ ...fields, status: "success"|"error" }` (xem tool-result.mjs, TL-03).
 *
 * Ghi chú kiến trúc:
 *  - take_ai_screenshot KHÔNG còn qua Python: chụp bằng desktopCapturer ngay trong tiến trình Electron (TL-11).
 *  - quick_reminder do Electron quản lý (reminders.mjs), không còn tiến trình Python `sleep` (TL-09).
 *  - moveWindowPreciseTool GỌI tools/move_window.py (ctypes, không còn PowerShell — TL-01).
 *  - Mọi tool nguy hiểm đi qua xác nhận hai bước ở tool-dispatcher.mjs (dangerous-tools.mjs).
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

import { toolsDir, pythonBin, userDataDir } from "./paths.mjs";
import { killTree } from "./process-utils.mjs";
import { buildToolResponse, optArg, toIntArg } from "./tool-result.mjs";
import { frameToScreen } from "./coords.mjs";
import { saveScreenshot } from "./screenshot-store.mjs";
import { createReminderService } from "./reminders.mjs";

// G-08: các script dưới đây dùng ctypes.windll / WMI / PowerShell / netsh... => chỉ chạy được trên Windows.
export const WINDOWS_ONLY_TOOLS = new Set([
  "active_window_info.py", "desktop_manager.py", "focus_assist.py", "idle_time.py", "lock_screen.py",
  "magic_move.py", "move_window.py", "multi_monitor_info.py", "power_manager.py", "read_notifications.py",
  "search_everything.py", "sys_control.py", "system_actions.py", "wifi_manager.py", "mouse_control.py",
  "media_control.py", "image_viewer.py", "clipboard_history.py", "process_manager.py", "ocr_region.py",
  "color_picker.py", "file_explorer.py", "iris_showcase.py",
  "universal_app_launcher.py", "terminal_executor.py", "filesystem_ops.py", "window_manager.py", "system_ops.py",
]);

export const MAX_STDOUT_BYTES = 1_000_000; // TL: giới hạn stdout ≤ 1 MB

/** Môi trường chuẩn cho mọi tiến trình Python (TL-10: UTF-8; Python biết PID của Iris để không tự đóng mình). */
export function pythonEnv(extra = {}) {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    IRIS_USER_DATA: userDataDir(),
    IRIS_SELF_PID: String(process.pid),
    IRIS_SCREENSHOT_DIR: join(userDataDir(), "screenshots"),
    ...extra,
  };
}

/**
 * Chạy `python tools/<script> ...args`. Không bao giờ reject.
 * @param {string} script
 * @param {string[]} args
 * @param {{timeoutMs?:number, stdin?:string, onTimeout?:()=>Promise<void>|void, onLine?:(line:string)=>void}} [opts]
 * @returns {Promise<{ok:boolean,code?:number,stdout:string,stderr:string,error?:string,timedOut?:boolean}>}
 */
export function runPythonTool(script, args = [], { timeoutMs = 20000, stdin = undefined, onTimeout, onLine = undefined } = {}) {
  if (process.platform !== "win32" && WINDOWS_ONLY_TOOLS.has(script)) {
    return Promise.resolve({
      ok: false, stdout: "", stderr: "",
      error: `Công cụ ${script} chỉ hỗ trợ Windows (hệ điều hành hiện tại: ${process.platform}).`,
    });
  }
  const pyPath = join(toolsDir(), script);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    let truncated = false;
    let lineBuf = "";

    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    const timer = setTimeout(async () => {
      if (settled) return;
      // killTree trước (TerminateProcess không chạy `finally` của Python), rồi dọn dẹp (vd. nhả nút chuột).
      try { killTree(child); } catch { /* bỏ qua */ }
      try { await onTimeout?.(); } catch { /* bỏ qua */ }
      finish({ ok: false, timedOut: true, error: `Quá thời gian ${timeoutMs}ms`, stdout: stdout.trim(), stderr: stderr.trim() });
    }, timeoutMs);

    try {
      child = spawn(pythonBin(), [pyPath, ...args], {
        shell: false, windowsHide: true, env: pythonEnv(), stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      finish({ ok: false, error: err.message, stdout: "", stderr: "" });
      return;
    }

    child.stdout.setEncoding("utf8"); // StringDecoder: không vỡ ký tự nhiều byte giữa các chunk (R-04)
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      if (stdout.length + d.length > MAX_STDOUT_BYTES) {
        truncated = true;
        stdout += d.slice(0, Math.max(0, MAX_STDOUT_BYTES - stdout.length));
        try { killTree(child); } catch { /* bỏ qua */ }
      } else stdout += d;

      if (typeof onLine === "function") {
        lineBuf += d;
        let idx;
        while ((idx = lineBuf.indexOf("\n")) >= 0) {
          const l = lineBuf.slice(0, idx).trim();
          lineBuf = lineBuf.slice(idx + 1);
          if (l) {
            try { onLine(l); } catch { /* bỏ qua */ }
          }
        }
      }
    });
    child.stderr.on("data", (d) => { if (stderr.length < 64_000) stderr += d; });
    child.stdin.on("error", () => {});
    if (stdin !== undefined) child.stdin.end(stdin, "utf8");
    else child.stdin.end();
    // WIN-PY-STUB: trên Windows, "python" có thể chỉ là alias Microsoft Store (thoát mã 9009) hoặc thiếu hẳn.
    const py = pythonBin();
    const pyHint = `Cài Python 3 từ python.org (tick "Add python.exe to PATH"), chạy "pip install -r tools/requirements.txt" rồi khởi động lại IRIS (hoặc đặt IRIS_PYTHON_BIN trong .env).`;
    child.on("error", (err) =>
      finish({
        ok: false,
        error: err.code === "ENOENT" ? `Không tìm thấy Python ("${py}"). ${pyHint}` : err.message,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }),
    );
    child.on("close", (code) => {
      if (typeof onLine === "function" && lineBuf.trim()) {
        try { onLine(lineBuf.trim()); } catch { /* bỏ qua */ }
      }
      let hint;
      if (code === 9009) hint = `"${py}" chỉ là alias Microsoft Store, Python chưa được cài thật. ${pyHint}`;
      else if (code !== 0) {
        const m = stderr.match(/ModuleNotFoundError: No module named '([^']+)'/);
        if (m) hint = `Thiếu thư viện Python "${m[1]}". Chạy: ${py} -m pip install -r tools/requirements.txt`;
      }
      if (hint) console.error(`[local-tools] ${script}: ${hint}`);
      finish({
        ok: code === 0 && !truncated,
        code: truncated ? 1 : code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        ...(truncated ? { error: `Đầu ra vượt ${MAX_STDOUT_BYTES} byte nên bị cắt.` } : hint ? { error: hint } : {}),
      });
    });
  });
}

/** Chạy script, parse JSON, chuẩn hoá — dùng cho mọi tool trả JSON. */
async function runJsonTool(script, args, opts, failMsg) {
  const run = await runPythonTool(script, args, opts);
  return buildToolResponse(run, failMsg || `${script} thất bại.`);
}

// -----------------------------------------------------------------------
// take_ai_screenshot — chụp trong Electron (desktopCapturer), KHÔNG qua Python (TL-11)
// -----------------------------------------------------------------------
export async function takeAiScreenshotTool(args = {}) {
  const save = args?.save === true;
  try {
    const { grabPrimaryScreenJpeg, analyzeImageWithVisionApi } = await import("./vision.mjs");
    const { sendVideoFrame } = await import("./gemini-live.mjs"); // import trễ: tránh vòng tròn với dispatcher
    const { buffer, geometry } = await grabPrimaryScreenJpeg(75);
    const b64 = buffer.toString("base64");
    const sent = sendVideoFrame(b64, "image/jpeg");
    let screenshot_path;
    if (save) screenshot_path = saveScreenshot(join(userDataDir(), "screenshots"), buffer);
    if (!sent) {
      return {
        status: "error", ...(screenshot_path ? { screenshot_path } : {}),
        error: "Đã chụp màn hình nhưng KHÔNG gửi được ảnh lên Gemini (chưa có phiên Live hoặc ảnh không hợp lệ).",
      };
    }
    const [vision_summary, activeWin] = await Promise.all([
      analyzeImageWithVisionApi(b64, "màn hình máy tính"),
      activeWindowInfoTool().catch(() => null),
    ]);
    const winTitle = activeWin?.title ? String(activeWin.title).trim() : "";
    const winProc = activeWin?.process_name ? String(activeWin.process_name).trim() : "";
    const activeWinDesc = winTitle ? `${winTitle}${winProc ? ` (${winProc})` : ""}` : "";
    return {
      status: "success",
      ...(screenshot_path ? { screenshot_path } : {}),
      ...(activeWinDesc ? { active_window: activeWinDesc } : {}),
      ...(vision_summary ? { vision_summary } : {}),
      frame_geometry: geometry,
      instructions:
        "Ảnh chụp màn hình MỚI NHẤT VỪA CHỤP NGAY BÂY GIỜ đã được gửi cho bạn dưới dạng một khung hình. " +
        (activeWinDesc ? `Cửa sổ đang mở trên cùng hiện tại: "${activeWinDesc}". ` : "") +
        (vision_summary ? `Kết quả phân tích hình ảnh AI trực tiếp: "${vision_summary}". ` : "") +
        "Hãy nhìn trực tiếp vào ảnh vừa nhận kết hợp thông tin cửa sổ hiện tại và mô tả NGẮN GỌN, CHÍNH XÁC trong 1-2 câu đúng trọng tâm những gì đang mở trên màn hình (TUYỆT ĐỐI không nói rông dài, không dùng ảnh cũ từ lượt trước, không đoán mò từ lịch sử hội thoại cũ). " +
        "Nếu cần click vào một điểm trong ảnh, gọi mouse_control với space:\"frame\".",
    };
  } catch (err) {
    return { status: "error", error: `Không chụp được màn hình: ${err.message}` };
  }
}

// -----------------------------------------------------------------------
// clipboard
// -----------------------------------------------------------------------
export async function readClipboardTool() {
  const r = await runJsonTool("clipboard_manager.py", ["--action=read"], { timeoutMs: 10000 }, "clipboard_manager.py thất bại.");
  if (r.status === "success") r.clipboard_text = r.text ?? "";
  return r;
}

export async function writeClipboardTool(args = {}) {
  const { text } = args;
  if (!text) return { status: "error", error: "Thiếu 'text' để ghi vào clipboard." };
  // Văn bản dài/nhạy cảm đi qua STDIN: không dính giới hạn dòng lệnh ~32 KB và không lộ trong danh sách tiến trình.
  return runJsonTool("clipboard_manager.py", ["--action=write", "--stdin"], { timeoutMs: 10000, stdin: String(text) }, "clipboard_manager.py thất bại.");
}

// -----------------------------------------------------------------------
// window magic (TL-07: --active có đếm ngược THẬT; demo chỉ khi IRIS_DEV_TOOLS=1)
// -----------------------------------------------------------------------
export async function moveWindowMagicTool(args = {}) {
  const { mode = "active", name, wait } = args;
  const x = toIntArg(args.x ?? 0) ?? 0;
  const y = toIntArg(args.y ?? 0) ?? 0;

  if (mode === "active") {
    // Nếu args có truyền wait (đếm ngược cụ thể), thì đợi; mặc định wait=0 để di chuyển TRỰC TIẾP ngay lập tức
    const waitSec = wait !== undefined && wait !== null ? Math.max(0, Math.min(Number(wait) || 0, 30)) : 0;
    const r = await runJsonTool(
      "magic_move.py",
      ["--active", `--wait=${waitSec}`, `-x=${x}`, `-y=${y}`],
      { timeoutMs: (waitSec + 10) * 1000 },
      "magic_move.py thất bại."
    );
    return { ...r, instructions: "Báo cho người dùng cửa sổ đã được di chuyển thành công." };
  }
  if (mode === "demo") {
    if (process.env.IRIS_DEV_TOOLS !== "1") return { status: "error", error: "Chế độ demo bị tắt (chỉ bật khi IRIS_DEV_TOOLS=1)." };
    if (!name) return { status: "error", error: "Thiếu 'name' cho chế độ demo." };
    return runJsonTool("magic_move.py", ["--demo", optArg("name", name)], { timeoutMs: 15000 }, "magic_move.py thất bại.");
  }
  return runJsonTool("magic_move.py", [optArg("name", name || "active"), `-x=${x}`, `-y=${y}`], { timeoutMs: 10000 }, "magic_move.py thất bại.");
}

// -----------------------------------------------------------------------
// notify
// -----------------------------------------------------------------------
export async function sendDesktopNotificationTool(args = {}) {
  const { title, message } = args;
  if (!title || !message) return { status: "error", error: "Thiếu 'title' hoặc 'message'." };
  return runJsonTool("notifier.py", [optArg("title", title), optArg("message", message)], { timeoutMs: 10000 }, "notifier.py thất bại.");
}

// -----------------------------------------------------------------------
// system_control (TL-12)
// -----------------------------------------------------------------------
export async function systemControlTool(args = {}) {
  const { volume, brightness, wifi, bluetooth, camera } = args;
  const volumeLevel = toIntArg(args.volume_level);
  const cliArgs = [];
  if (volume) cliArgs.push(optArg("volume", volume));
  if (volumeLevel !== null) cliArgs.push(optArg("volume-level", volumeLevel));
  const b = toIntArg(brightness);
  if (b !== null) cliArgs.push(optArg("brightness", b));
  if (wifi) cliArgs.push(optArg("wifi", wifi));
  if (bluetooth) cliArgs.push(optArg("bluetooth", bluetooth));
  if (camera) cliArgs.push(optArg("camera", camera));
  if (!cliArgs.length) {
    return { status: "error", error: "Chỉ định ít nhất một trong: volume, volume_level, brightness, wifi, bluetooth, camera." };
  }
  // Script chờ UAC (-Wait) rồi mới trả kết quả THẬT ⇒ timeout dài hơn để người dùng kịp bấm 'Yes'.
  const needsUac = Boolean(bluetooth || camera);
  const r = await runJsonTool("sys_control.py", cliArgs, { timeoutMs: needsUac ? 60000 : 15000 }, "sys_control.py thất bại.");
  if (needsUac && r.status === "error" && /Quá thời gian/.test(r.error || "")) {
    r.error = "Hết thời gian chờ — có thể bảng UAC chưa được xác nhận. Hãy nhờ người dùng bấm 'Yes' rồi thử lại.";
  }
  return r;
}

// -----------------------------------------------------------------------
// mouse_control (TL-04, TL-05)
// -----------------------------------------------------------------------
const MOUSE_TIMEOUT_MS = { move: 10000, click: 10000, drag: 20000, scroll: 8000, position: 5000, release: 5000 };

async function releaseMouse() {
  await runPythonTool("mouse_control.py", ["release"], { timeoutMs: 5000 });
}

export async function mouseControlTool(args = {}) {
  const { action, button = "left", double = false, click = false, linear = false, human_like = false, space = "screen" } = args;
  if (!action) return { status: "error", error: "Thiếu 'action' (move, click, drag, scroll, position, release)." };
  if (!(action in MOUSE_TIMEOUT_MS)) {
    return { status: "error", error: `Action '${action}' không hợp lệ. Dùng: move, click, drag, scroll, position, release.` };
  }

  let x = toIntArg(args.x), y = toIntArg(args.y), x2 = toIntArg(args.x2), y2 = toIntArg(args.y2);
  const amount = toIntArg(args.amount);
  const monitor = toIntArg(args.monitor);

  // TL-05: toạ độ đọc TỪ ẢNH (khung đã thu nhỏ) → pixel vật lý.
  if (space === "frame" && ["move", "click", "drag"].includes(action)) {
    try {
      const { visionFrameGeometry } = await import("./vision.mjs");
      const g = visionFrameGeometry();
      if (x !== null && y !== null) ({ x, y } = frameToScreen(x, y, g));
      if (x2 !== null && y2 !== null) ({ x: x2, y: y2 } = frameToScreen(x2, y2, g));
    } catch (e) {
      return { status: "error", error: `Không đổi được toạ độ khung → màn hình: ${e.message}` };
    }
  } else if (space !== "screen" && space !== "frame") {
    return { status: "error", error: "space phải là 'screen' hoặc 'frame'." };
  }

  const cli = [action];
  if (action === "move" || action === "click") {
    if (x === null || y === null) return { status: "error", error: "'x' và 'y' (số) là bắt buộc cho move/click." };
    cli.push(String(x), String(y));
    if (!human_like) cli.push("--fast"); // mặc định NHANH; đường Bezier mềm chỉ khi human_like:true
    if (linear) cli.push("--linear");
    cli.push(optArg("button", button));
    if (double) cli.push("--double");
    if (action === "move" && click) cli.push("--click");
  } else if (action === "drag") {
    if ([x, y, x2, y2].some((v) => v === null)) return { status: "error", error: "'x','y','x2','y2' đều bắt buộc cho drag." };
    cli.push(String(x), String(y), String(x2), String(y2), optArg("button", button));
    if (!human_like) cli.push("--fast");
  } else if (action === "scroll") {
    if (amount === null) return { status: "error", error: "'amount' (số) là bắt buộc cho scroll (dương = lên, âm = xuống)." };
    cli.push(String(amount));
  }
  if (monitor !== null && ["move", "click", "drag"].includes(action)) cli.push(optArg("monitor", monitor));

  // Hết giờ ⇒ killTree rồi `release` để nút chuột không bị kẹt (TL-04b).
  return runJsonTool(
    "mouse_control.py", cli,
    { timeoutMs: MOUSE_TIMEOUT_MS[action], onTimeout: action === "drag" || action === "click" || action === "move" ? releaseMouse : undefined },
    "mouse_control.py thất bại.",
  );
}

// -----------------------------------------------------------------------
// context tools
// -----------------------------------------------------------------------
export async function activeWindowInfoTool() {
  return runJsonTool("active_window_info.py", [], { timeoutMs: 8000 }, "active_window_info.py thất bại.");
}

export async function ocrRegionTool(args = {}) {
  const vals = [args.left, args.top, args.width, args.height].map(toIntArg);
  const cli = [];
  if (vals.every((v) => v !== null)) cli.push("--region", ...vals.map(String)); // nargs=4: bốn giá trị rời
  // lang: bỏ trống ⇒ để script tự chọn (IRIS_OCR_LANG hoặc vie+eng nếu có gói) — TL-15
  if (args.lang) cli.push(optArg("lang", args.lang));
  return runJsonTool("ocr_region.py", cli, { timeoutMs: 30000 }, "ocr_region.py thất bại.");
}

export async function colorPickerTool(args = {}) {
  const x = toIntArg(args.x), y = toIntArg(args.y);
  return runJsonTool("color_picker.py", x !== null && y !== null ? [String(x), String(y)] : [], { timeoutMs: 8000 }, "color_picker.py thất bại.");
}

export async function idleTimeTool() {
  return runJsonTool("idle_time.py", [], { timeoutMs: 8000 }, "idle_time.py thất bại.");
}

export async function sysMonitorTool() {
  return runJsonTool("sys_monitor.py", [], { timeoutMs: 10000 }, "sys_monitor.py thất bại.");
}

// -----------------------------------------------------------------------
// clipboard_history (TL-08: mặc định TẮT, có chỉ báo)
// -----------------------------------------------------------------------
const clipboardHistoryEnabled = () => process.env.IRIS_CLIPBOARD_HISTORY === "1";

export async function clipboardHistoryTool(args = {}) {
  const { action, limit = 10, index } = args;
  if (!action) return { status: "error", error: "Thiếu 'action' (start, stop, list, use, clear)." };
  if (action !== "stop" && action !== "clear" && !clipboardHistoryEnabled()) {
    return {
      status: "error",
      error: "Lịch sử clipboard đang TẮT để bảo vệ quyền riêng tư (clipboard có thể chứa mật khẩu/OTP). Người dùng cần tự bật bằng IRIS_CLIPBOARD_HISTORY=1 trong .env rồi khởi động lại Iris.",
    };
  }
  if (action === "start") {
    const r = await runJsonTool("clipboard_history.py", ["start"], { timeoutMs: 12000 }, "clipboard_history.py start thất bại.");
    if (r.status === "success") {
      try {
        const { emitEvent } = await import("./events.mjs");
        emitEvent({ type: "log", level: "warn", message: "🔴 Đang theo dõi clipboard (ngắn hạn, bỏ qua mật khẩu/OTP/số thẻ)." });
      } catch { /* bỏ qua */ }
    }
    return r;
  }
  if (action === "stop") return runJsonTool("clipboard_history.py", ["stop"], { timeoutMs: 8000 }, "clipboard_history.py stop thất bại.");
  if (action === "list") return runJsonTool("clipboard_history.py", ["list", optArg("limit", toIntArg(limit) ?? 10)], { timeoutMs: 8000 }, "clipboard_history.py list thất bại.");
  if (action === "use") {
    const i = toIntArg(index);
    if (i === null) return { status: "error", error: "'index' (số) là bắt buộc cho action 'use'." };
    return runJsonTool("clipboard_history.py", ["use", String(i)], { timeoutMs: 8000 }, "clipboard_history.py use thất bại.");
  }
  if (action === "clear") return runJsonTool("clipboard_history.py", ["clear"], { timeoutMs: 8000 }, "clipboard_history.py clear thất bại.");
  return { status: "error", error: `Action '${action}' không hợp lệ. Dùng: start, stop, list, use, clear.` };
}

/** Gọi khi Iris thoát: dừng vòng lặp theo dõi clipboard (nếu có). Không bao giờ ném lỗi. */
export async function stopClipboardWatcher() {
  try { await runPythonTool("clipboard_history.py", ["stop"], { timeoutMs: 5000 }); } catch { /* bỏ qua */ }
}

// -----------------------------------------------------------------------
// quick_reminder — Electron quản lý (TL-09)
// -----------------------------------------------------------------------
let reminderService = null;
function getReminderService() {
  if (!reminderService) {
    reminderService = createReminderService({
      file: join(userDataDir(), "reminders.json"),
      notify: async ({ title, message }) => {
        const electron = (await import("electron")).default;
        const { Notification } = electron;
        if (!Notification?.isSupported?.()) throw new Error("Hệ điều hành không hỗ trợ thông báo.");
        new Notification({ title, body: message, silent: false }).show();
        try {
          const { emitEvent } = await import("./events.mjs");
          emitEvent({ type: "log", level: "info", message: `⏰ Nhắc việc: ${title} — ${message}` });
        } catch { /* bỏ qua */ }
      },
      log: (m) => console.warn(m),
    });
  }
  return reminderService;
}

/** main.mjs gọi sau app.whenReady(). */
export function initReminders() {
  return getReminderService().load();
}
export function disposeReminders() {
  reminderService?.dispose();
}

export async function quickReminderTool(args = {}) {
  const { action, title, message, id } = args;
  if (!action) return { status: "error", error: "Thiếu 'action' (schedule, list, cancel)." };
  const svc = getReminderService();
  const wrap = (r) => {
    const { success, ...rest } = r;
    return { ...rest, status: success ? "success" : "error" };
  };
  if (action === "schedule") return wrap(svc.schedule({ minutes: args.minutes, title, message }));
  if (action === "list") return wrap(svc.list());
  if (action === "cancel") {
    if (!id) return { status: "error", error: "'id' là bắt buộc cho action 'cancel'." };
    return wrap(svc.cancel(String(id)));
  }
  return { status: "error", error: `Action '${action}' không hợp lệ. Dùng: schedule, list, cancel.` };
}

// -----------------------------------------------------------------------
// network
// -----------------------------------------------------------------------
export async function wifiManagerTool(args = {}) {
  const { action, ssid } = args;
  if (!action) return { status: "error", error: "Thiếu 'action' (list, profiles, connect, disconnect, status)." };
  if (action === "connect") {
    if (!ssid) return { status: "error", error: "'ssid' là bắt buộc cho action 'connect'." };
    return runJsonTool("wifi_manager.py", ["connect", String(ssid)], { timeoutMs: 20000 }, "wifi_manager.py connect thất bại.");
  }
  if (["list", "profiles", "disconnect", "status"].includes(action)) {
    return runJsonTool("wifi_manager.py", [action], { timeoutMs: 20000 }, `wifi_manager.py ${action} thất bại.`);
  }
  return { status: "error", error: `Action '${action}' không hợp lệ. Dùng: list, profiles, connect, disconnect, status.` };
}

export async function multiMonitorInfoTool() {
  return runJsonTool("multi_monitor_info.py", [], { timeoutMs: 8000 }, "multi_monitor_info.py thất bại.");
}

// -----------------------------------------------------------------------
// process_manager (TL-02)
// -----------------------------------------------------------------------
export async function processManagerTool(args = {}) {
  const { action, sort = "ram", name } = args;
  const top = toIntArg(args.top) ?? 10;
  const force = args.force === true;
  if (!action) return { status: "error", error: "Thiếu 'action' (list, kill)." };
  if (action === "list") {
    if (!["cpu", "ram"].includes(sort)) return { status: "error", error: "sort phải là 'cpu' hoặc 'ram'." };
    return runJsonTool("process_manager.py", ["list", optArg("sort", sort), optArg("top", top)], { timeoutMs: 12000 }, "process_manager.py list thất bại.");
  }
  if (action === "kill") {
    if (!name) return { status: "error", error: "'name' là bắt buộc cho action 'kill' (vd 'chrome.exe')." };
    return runJsonTool("process_manager.py", ["kill", String(name), ...(force ? ["--force"] : [])], { timeoutMs: 15000 }, "process_manager.py kill thất bại.");
  }
  return { status: "error", error: `Action '${action}' không hợp lệ. Dùng: list, kill.` };
}

export async function focusAssistTool() {
  return runJsonTool("focus_assist.py", [], { timeoutMs: 8000 }, "focus_assist.py thất bại.");
}

export async function lockScreenTool() {
  return runJsonTool("lock_screen.py", [], { timeoutMs: 8000 }, "lock_screen.py thất bại.");
}

// -----------------------------------------------------------------------
// view_image — chỉ hiển thị cho NGƯỜI DÙNG (TL-11)
// -----------------------------------------------------------------------
export async function viewImageTool(args = {}) {
  const act = args?.action;
  if (!act) return { status: "error", error: "Thiếu tham số 'action' (latest, prev, next, close)." };
  if (!["latest", "prev", "next", "close"].includes(act)) {
    return { status: "error", error: `Action '${act}' không hợp lệ. Dùng: latest, prev, next, close.` };
  }
  const dir = join(userDataDir(), "screenshots");
  return runJsonTool("image_viewer.py", [optArg("action", act), optArg("dir", dir)], { timeoutMs: 12000 }, "image_viewer.py thất bại.");
}

// -----------------------------------------------------------------------
// move_window_precise (TL-01: ctypes, không còn PowerShell)
// -----------------------------------------------------------------------
export async function moveWindowPreciseTool(args = {}) {
  const name = args.name || "active";
  const x = toIntArg(args.x ?? 0) ?? 0;
  const y = toIntArg(args.y ?? 0) ?? 0;
  const cli = [String(name), String(x), String(y)];
  const w = toIntArg(args.width), h = toIntArg(args.height);
  if (w !== null) cli.push(optArg("width", w));
  if (h !== null) cli.push(optArg("height", h));
  return runJsonTool("move_window.py", cli, { timeoutMs: 10000 }, "move_window.py thất bại.");
}

// -----------------------------------------------------------------------
// power / media / desktop
// -----------------------------------------------------------------------
export async function powerManagerTool(args = {}) {
  const act = args?.action;
  if (!["sleep", "shutdown", "restart"].includes(act)) return { status: "error", error: "action phải là sleep, shutdown hoặc restart." };
  return runJsonTool("power_manager.py", [act], { timeoutMs: 12000 }, "power_manager.py thất bại.");
}

export async function mediaControlTool(args = {}) {
  const act = args?.action;
  if (!["playpause", "next", "prev"].includes(act)) return { status: "error", error: "action phải là playpause, next hoặc prev." };
  return runJsonTool("media_control.py", [act], { timeoutMs: 8000 }, "media_control.py thất bại.");
}

export async function desktopManagerTool(args = {}) {
  const act = args?.action;
  if (!["new", "close", "left", "right", "boss"].includes(act)) return { status: "error", error: "action phải là new, close, left, right hoặc boss." };
  return runJsonTool("desktop_manager.py", [act], { timeoutMs: 8000 }, "desktop_manager.py thất bại.");
}

// -----------------------------------------------------------------------
// search / notifications (TL-08: riêng tư)
// -----------------------------------------------------------------------
export async function searchEverythingTool(args = {}) {
  const { query } = args;
  const max = toIntArg(args.max) ?? 10;
  if (!query) return { status: "error", error: "Thiếu tham số 'query'." };
  const r = await runJsonTool("search_everything.py", [String(query), optArg("max", max)], { timeoutMs: 12000 }, "search_everything.py thất bại.");
  if (r.status === "success") r.count = Array.isArray(r.results) ? r.results.length : 0;
  return r;
}

export async function readNotificationsTool(args = {}) {
  const limit = toIntArg(args.limit) ?? 5;
  const cli = [optArg("limit", limit)];
  if (args.reveal_otp === true) cli.push("--reveal-otp");
  return runJsonTool("read_notifications.py", cli, { timeoutMs: 15000 }, "read_notifications.py thất bại.");
}

// -----------------------------------------------------------------------
// system_actions.py: close/hide/minimize/restore/note (dùng bởi computer-use-tools.mjs)
// -----------------------------------------------------------------------
function appTarget(raw) {
  return String(raw ?? "").split(/[\\/]/).pop().trim();
}

export async function systemActionTool(action, target, extra = []) {
  const t = appTarget(target);
  if (!t) return { status: "error", error: "Thiếu 'target' (tên file .exe hoặc một phần tiêu đề cửa sổ)." };
  return runJsonTool("system_actions.py", [action, t, ...extra], { timeoutMs: 20000 }, `system_actions.py ${action} thất bại.`);
}

export async function writeNoteScriptTool(text, isNew) {
  if (!text) return { status: "error", error: "Thiếu 'text'." };
  return runJsonTool("system_actions.py", ["note", optArg("text", text), ...(isNew ? ["--new"] : [])], { timeoutMs: 15000 }, "system_actions.py note thất bại.");
}

// -----------------------------------------------------------------------
// file_explorer.py: mở thư mục hoặc bôi đen file trong File Explorer
// -----------------------------------------------------------------------
export async function fileExplorerTool(args = {}) {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const action = typeof args.action === "string" ? args.action.trim() : "auto";
  const cli = [];
  if (path) cli.push(path);
  if (action && action !== "auto") cli.push(`--action=${action}`);
  if (args.select === true) cli.push("--select");
  return runJsonTool("file_explorer.py", cli, { timeoutMs: 15000 }, "file_explorer.py thất bại.");
}

// -----------------------------------------------------------------------
// iris_showcase.py: trình diễn trực tiếp các khả năng của Iris
// -----------------------------------------------------------------------
let isShowcaseRunning = false;

export async function irisShowcaseTool(_args = {}) {
  if (isShowcaseRunning) {
    return {
      status: "busy",
      output: "Màn trình diễn đang diễn ra, vui lòng chờ Iris hoàn tất.",
    };
  }
  isShowcaseRunning = true;

  const { enterHud } = await import("./window-manager.mjs");
  const { emitEvent } = await import("./events.mjs");
  const { setAudioChunkSuppressed } = await import("./gemini-live.mjs");

  // Chống lặp âm thanh: Tạm thời ngắt luồng mic gửi lên Gemini Live trong lúc Iris nói và trình diễn
  setAudioChunkSuppressed(true);

  try {
    // Vào chế độ Glass HUD (Alt + Space) trước khi trình diễn
    enterHud();
    await new Promise((r) => setTimeout(r, 100));

    emitEvent({ type: "audio_state", state: "speaking" });
    emitEvent({
      type: "transcript",
      speaker: "iris",
      text: "Sau đây là màn trình diễn trực tiếp khả năng điều khiển hệ thống của Iris.",
    });

    const onLine = (line) => {
      if (line.startsWith("IRIS_SHOWCASE_STEP:")) {
        try {
          const payload = JSON.parse(line.slice("IRIS_SHOWCASE_STEP:".length));
          emitEvent({ type: "audio_state", state: "speaking" });
          // step 0 = lời giới thiệu Iris (không đánh số); các bước sau hiển thị [n/tổng]
          const prefix = payload.step > 0 ? `[${payload.step}/${payload.total ?? 10}] ` : "";
          emitEvent({ type: "transcript", speaker: "iris", text: `${prefix}${payload.speech}` });
        } catch {
          // bỏ qua nếu lỗi parse
        }
      }
    };

    // 10 bước + lời giới thiệu (mỗi bước có giọng đọc) chạy ~1 phút; đệm rộng để không bị kill khi độ sáng đang giảm.
    const run = await runPythonTool("iris_showcase.py", [], { timeoutMs: 120000, onLine });
    const res = buildToolResponse(run, "iris_showcase.py thất bại.");

    const { liveStatus } = await import("./gemini-live.mjs");
    emitEvent({ type: "audio_state", state: liveStatus?.running ? "listening" : "idle" });
    emitEvent({
      type: "transcript",
      speaker: "iris",
      text: "Đã hoàn thành toàn bộ màn trình diễn trực tiếp!",
    });

    return res;
  } finally {
    setAudioChunkSuppressed(false);
    isShowcaseRunning = false;
  }
}

// -----------------------------------------------------------------------
// Super Assistant Power Tools — có thể bật/tắt từng quyền trong Settings (.env)
// Mặc định BẬT ("true" / "1") trừ khi người dùng chủ động tắt ("false" / "0").
// -----------------------------------------------------------------------
function isSuperFeatureEnabled(envName) {
  const val = String(process.env[envName] ?? "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(val);
}

export async function universalAppLauncherTool(args = {}) {
  if (!isSuperFeatureEnabled("IRIS_UNIVERSAL_APPS")) {
    return {
      status: "error",
      error: "Quyền 'Mở mọi ứng dụng (Universal App Launcher)' đang TẮT trong Cài đặt. Vui lòng bật trong Settings -> Hệ thống & Điều khiển.",
    };
  }
  const command = String(args.command || "launch").trim().toLowerCase();
  const query = String(args.query || args.target || "").trim();
  const limit = toIntArg(args.limit) ?? 20;
  if (command === "list") {
    return runJsonTool("universal_app_launcher.py", ["list", optArg("limit", limit)], { timeoutMs: 15000 }, "universal_app_launcher.py list thất bại.");
  }
  if (!query) return { status: "error", error: "Thiếu 'query' (tên ứng dụng cần tìm hoặc mở)." };
  if (command === "search") {
    return runJsonTool("universal_app_launcher.py", ["search", query, optArg("limit", limit)], { timeoutMs: 15000 }, "universal_app_launcher.py search thất bại.");
  }
  const cli = ["launch", query];
  if (args.args) cli.push(optArg("args", String(args.args)));
  return runJsonTool("universal_app_launcher.py", cli, { timeoutMs: 15000 }, "universal_app_launcher.py launch thất bại.");
}

export async function runTerminalCommandTool(args = {}) {
  if (!isSuperFeatureEnabled("IRIS_TERMINAL_EXEC")) {
    return {
      status: "error",
      error: "Quyền 'Thực thi lệnh Terminal / PowerShell / Python' đang TẮT trong Cài đặt. Hãy nhắc người dùng bật trong Settings -> Hệ thống & Điều khiển nếu muốn dùng.",
    };
  }
  const shell = String(args.shell || "powershell").trim().toLowerCase();
  const command = String(args.command || "").trim();
  if (!command) return { status: "error", error: "Thiếu 'command' (câu lệnh cần chạy)." };
  const timeoutSec = Math.max(5, Math.min(toIntArg(args.timeout) ?? 30, 300));
  const cli = [optArg("shell", shell), optArg("timeout", timeoutSec), "--stdin"];
  if (args.cwd) cli.push(optArg("cwd", String(args.cwd)));
  return runJsonTool(
    "terminal_executor.py",
    cli,
    { timeoutMs: (timeoutSec + 5) * 1000, stdin: command },
    "terminal_executor.py thất bại.",
  );
}

export async function filesystemOpsTool(args = {}) {
  if (!isSuperFeatureEnabled("IRIS_FILESYSTEM_OPS")) {
    return {
      status: "error",
      error: "Quyền 'Quản lý File & Thư mục toàn diện' đang TẮT trong Cài đặt. Hãy nhắc người dùng bật trong Settings -> Hệ thống & Điều khiển.",
    };
  }
  const action = String(args.action || "").trim().toLowerCase();
  const path = String(args.path || "").trim();
  if (!action) return { status: "error", error: "Thiếu 'action' (list, read, write, append, mkdir, copy, move, rename, delete, info, zip, unzip)." };
  if (!path) return { status: "error", error: "Thiếu 'path' (đường dẫn file/thư mục)." };

  const cli = [action, path];
  if (args.dest) cli.push(optArg("dest", String(args.dest)));
  if (args.limit !== undefined) {
    const lim = toIntArg(args.limit);
    if (lim !== null) cli.push(optArg("limit", lim));
  }
  const isWrite = action === "write" || action === "append";
  if (isWrite) cli.push("--stdin");
  return runJsonTool(
    "filesystem_ops.py",
    cli,
    { timeoutMs: 30000, stdin: isWrite ? String(args.content ?? "") : undefined },
    `filesystem_ops.py ${action} thất bại.`,
  );
}

export async function windowManagerTool(args = {}) {
  if (!isSuperFeatureEnabled("IRIS_WINDOW_MANAGER")) {
    return {
      status: "error",
      error: "Quyền 'Quản lý Cửa sổ nâng cao' đang TẮT trong Cài đặt.",
    };
  }
  const action = String(args.action || "list").trim().toLowerCase();
  const cli = [action];
  if (args.target) cli.push(optArg("target", String(args.target)));
  if (args.position) cli.push(optArg("position", String(args.position)));
  if (args.state !== undefined) cli.push(optArg("state", String(args.state)));
  return runJsonTool("window_manager.py", cli, { timeoutMs: 10000 }, `window_manager.py ${action} thất bại.`);
}

export async function systemOpsTool(args = {}) {
  if (!isSuperFeatureEnabled("IRIS_SYSTEM_OPS")) {
    return {
      status: "error",
      error: "Quyền 'Quản trị Hệ thống, Mạng & Winget' đang TẮT trong Cài đặt. Hãy nhắc người dùng bật trong Settings -> Hệ thống & Điều khiển.",
    };
  }
  const action = String(args.action || "").trim().toLowerCase();
  if (!action) return { status: "error", error: "Thiếu 'action' (network, ports, ping, services, winget, clean_temp, empty_recycle_bin, env_list)." };
  const cli = [action];
  if (args.sub_action) cli.push(optArg("sub-action", String(args.sub_action)));
  if (args.query) cli.push(optArg("query", String(args.query)));
  const port = toIntArg(args.port);
  if (port !== null && port > 0) cli.push(optArg("port", port));
  const timeoutMs = action === "winget" ? 190000 : 30000;
  return runJsonTool("system_ops.py", cli, { timeoutMs }, `system_ops.py ${action} thất bại.`);
}

