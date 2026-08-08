/**
 * electron/main/sidecar-process.mjs
 *
 * Spawn/stop helper for the Python sidecar processes (live transcriber,
 * meeting recorder) that run alongside the Electron main process.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

// BUGFIX-SIDECAR-PYCMD-01: xem ghi chú đầy đủ ở spawnSidecar() bên dưới.
// Dò lệnh Python đúng cho máy hiện tại MỘT LẦN, đồng bộ, trước khi spawn thật
// — tránh phải "đổi proc giữa chừng" (dễ làm rớt listener stdout/stderr mà
// caller đã gắn vào proc cũ). Chi phí ~vài chục ms, chỉ chạy khi người dùng
// bấm Alt+T/Alt+M nên không ảnh hưởng hiệu năng.
let cachedPythonCommand = null;
export function resolvePythonCommand() {
  if (cachedPythonCommand) return cachedPythonCommand;
  const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      const res = spawnSync(cmd, ["--version"], { stdio: "ignore" });
      if (!res.error) {
        cachedPythonCommand = cmd;
        return cmd;
      }
    } catch (e) {
      // thử ứng viên tiếp theo
    }
  }
  // Không tìm thấy gì — trả về ứng viên đầu tiên để spawnSidecar() vẫn thử
  // và báo lỗi ENOENT rõ ràng qua onFatalError, thay vì âm thầm bỏ cuộc ở đây.
  return candidates[0];
}

// BUGFIX-SIDECAR-PYCMD-01: cả 2 caller (meeting-recording.mjs cho Alt+M,
// teleprompter.mjs cho Alt+T) từng gọi cứng `pythonPath = "python"`. Trên
// nhiều máy Linux và macOS hiện đại (Python cài qua Homebrew/python.org bản
// mới), PATH chỉ có `python3`, không có `python` — spawn ENOENT ngay lập
// tức, sidecar "chết" trong im lặng (chỉ console.error, người dùng app đóng
// gói không bao giờ thấy dòng đó), trong khi HUD vẫn đứng yên ở "Đang khởi
// động...". Alt+T/Alt+M vì vậy có vẻ "bấm không có phản ứng gì" trên các máy
// đó. Sửa ở 2 chỗ:
//   1. Caller giờ dùng resolvePythonCommand() (dò 1 lần, đồng bộ) thay vì
//      chuỗi cứng "python".
//   2. Nếu spawn vẫn ENOENT (vd người dùng chưa cài Python 3 gì cả), gọi
//      opts.onFatalError(message) để caller đẩy lỗi tiếng Việt rõ ràng lên
//      HUD, thay vì để người dùng chờ vô thời hạn không rõ vì sao.
export function spawnSidecar(pythonPath, args, opts = {}) {
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", ...(opts.env || {}) };
  const proc = spawn(pythonPath, args, { ...opts, env });
  const handle = { proc, state: "starting", exitCode: null };

  proc.once("spawn", () => {
    handle.state = "running";
  });

  // Bắt buộc phải có listener này — nếu không, khi spawn thất bại
  // (vd: "python" không có trong PATH) Node sẽ ném uncaught exception
  // và có thể crash cả main process của Electron.
  proc.on("error", (err) => {
    console.error(`[sidecar] spawn/runtime error (${args[0]}): ${err.message}`);
    handle.state = "dead";
    if (err.code === "ENOENT" && typeof opts.onFatalError === "function") {
      opts.onFatalError(
        `Không tìm thấy Python (đã thử chạy "${pythonPath}"). Cài Python 3 và ` +
        `đảm bảo nó có trong PATH rồi thử lại.`
      );
    }
  });

  proc.on("exit", (code, signal) => {
    handle.state = "dead";
    handle.exitCode = code;
    if (code !== 0 && code !== null) {
      console.error(`[sidecar] process thoát bất thường (${args[0]}), code=${code} signal=${signal}`);
    }
  });

  return handle;
}

/**
 * Dừng process an toàn: gửi "stop" qua stdin, đợi tối đa timeoutMs,
 * nếu không thoát thì force-kill. Luôn resolve (không bao giờ treo
 * vô hạn), và chặn race vì caller phải await xong mới được start lại.
 */
export function stopSidecar(handle, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    if (!handle || handle.state === "dead") return resolve();

    handle.state = "stopping";
    const proc = handle.proc;

    const killTimer = setTimeout(() => {
      console.warn("[sidecar] không thoát kịp sau stop, force kill");
      try { proc.kill("SIGKILL"); } catch (e) { /* ignore */ }
    }, timeoutMs);

    proc.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });

    try {
      proc.stdin.write("stop\n");
    } catch (e) {
      // stdin đã đóng (EPIPE) -> process coi như đã chết rồi, cứ để timer kill cho chắc
    }
  });
}
