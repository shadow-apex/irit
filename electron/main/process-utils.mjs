/**
 * electron/main/process-utils.mjs
 *
 * killTree(): dừng cả CÂY tiến trình (Windows: taskkill /T /F; POSIX: kill nhóm tiến
 * trình). Dùng cho mọi tiến trình con có thể sinh cháu (python, claude, ngrok...).
 * `child.kill()` chỉ giết tiến trình trực tiếp nên cháu bị mồ côi (R-05).
 *
 * Module thuần node, không import electron.
 */
import { spawnSync } from "node:child_process";

/**
 * @param {number|{pid?:number}} target pid hoặc ChildProcess
 * @param {{force?:boolean}} [opts] force=true (mặc định) = SIGKILL / taskkill /F
 * @returns {boolean} true nếu đã gửi tín hiệu dừng
 */
export function killTree(target, { force = true } = {}) {
  const pid = typeof target === "number" ? target : target?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const sig = force ? "SIGKILL" : "SIGTERM";
  if (process.platform === "win32") {
    try {
      const args = ["/pid", String(pid), "/T"];
      if (force) args.push("/F");
      spawnSync("taskkill", args, { windowsHide: true, stdio: "ignore" });
      return true;
    } catch {
      /* rơi xuống kill thường */
    }
  } else {
    try {
      // Âm pid = cả nhóm; chỉ có tác dụng nếu tiến trình được spawn với detached:true.
      process.kill(-pid, sig);
      return true;
    } catch {
      /* không phải leader của nhóm */
    }
  }
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
}
