/**
 * electron/main/sidecar-process.mjs
 *
 * Spawn/stop helper for the Python sidecar processes (live transcriber,
 * meeting recorder) that run alongside the Electron main process.
 */
import { spawn, spawnSync } from "node:child_process";
import { killTree } from "./process-utils.mjs";

// BUGFIX-SIDECAR-PYCMD-01: xem ghi chú đầy đủ ở spawnSidecar() bên dưới.
// Dò lệnh Python đúng cho máy hiện tại MỘT LẦN, đồng bộ, trước khi spawn thật
// — tránh phải "đổi proc giữa chừng" (dễ làm rớt listener stdout/stderr mà
// caller đã gắn vào proc cũ). Chi phí ~vài chục ms, chỉ chạy khi người dùng
// bấm Alt+T/Alt+M nên không ảnh hưởng hiệu năng.
let cachedPythonCommand = null;
export function resolvePythonCommand() {
  // P-01: IRIS_PYTHON_BIN (nếu đặt) luôn thắng, không cache để đổi .env có hiệu lực.
  const forced = String(process.env.IRIS_PYTHON_BIN || "").trim();
  if (forced) return forced;
  if (cachedPythonCommand) return cachedPythonCommand;
  const candidates = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      // WIN-PY-STUB: trên Windows, python.exe trong %LOCALAPPDATA%\Microsoft\WindowsApps là
      // "App Execution Alias" của Microsoft Store — spawn được (không có res.error) nhưng chỉ in
      // "Python was not found..." rồi thoát mã 9009. Phải kiểm tra status === 0, nếu không mọi
      // tool trong tools/ đều hỏng âm thầm khi Gemini Live gọi.
      const res = spawnSync(cmd, ["--version"], { stdio: "ignore", windowsHide: true, timeout: 5000 });
      if (!res.error && res.status === 0) {
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

function cleanupSidecarStreams(proc) {
  if (!proc) return;
  for (const s of [proc.stdin, proc.stdout, proc.stderr]) {
    if (!s) continue;
    try { s.removeAllListeners(); } catch { /* ignore */ }
    try { if (!s.destroyed) s.destroy(); } catch { /* ignore */ }
  }
}

export function spawnSidecar(pythonPath, args, opts = {}) {
  const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...(opts.env || {}) };
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
 * nếu không thoát thì force-kill cả cây tiến trình. Luôn resolve (không bao giờ treo
 * vô hạn), dọn sạch stdio pipes và chặn race vì caller phải await xong mới được start lại.
 */
export function stopSidecar(handle, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    if (!handle || handle.state === "dead") {
      cleanupSidecarStreams(handle?.proc);
      return resolve();
    }

    handle.state = "stopping";
    const proc = handle.proc;

    const killTimer = setTimeout(() => {
      console.warn("[sidecar] không thoát kịp sau stop, force kill tree");
      try { killTree(proc); } catch { /* ignore */ }
      try { proc.kill("SIGKILL"); } catch { /* ignore */ }
      cleanupSidecarStreams(proc);
      resolve();
    }, timeoutMs);

    proc.once("exit", () => {
      clearTimeout(killTimer);
      cleanupSidecarStreams(proc);
      resolve();
    });

    try {
      proc.stdin.write("stop\n");
    } catch (e) {
      // stdin đã đóng (EPIPE) -> process coi như đã chết rồi, cứ để timer kill cho chắc
    }
  });
}
