/**
 * electron/main/paths.mjs
 *
 * repoRoot for the split-out main-process modules (electron/main/*.mjs is
 * one directory deeper than the original electron/main.mjs, so this is
 * computed relative to *this* file, not reused from electron/main.mjs).
 *
 * P-01: mọi đường dẫn tới tools/ và .env phải tính từ đây — KHÔNG dùng
 * process.cwd() (khi chạy gói đã đóng, cwd là thư mục cài đặt hoặc System32).
 *
 * Module này không import electron (đúng ranh giới kiến trúc ở CLAUDE.md). Thư
 * mục userData do main.mjs đăng ký qua setUserDataDir().
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePythonCommand } from "./sidecar-process.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");

// Khi đóng gói bằng asar, Python không đọc được file nằm trong app.asar; các file cần
// cho Python được `asarUnpack` (xem package.json) và nằm ở app.asar.unpacked.
export function unpackedRepoRoot() {
  return repoRoot.replace(/app\.asar(?![.\w])/, "app.asar.unpacked");
}

/** Thư mục chứa các script Python của tools/ (IRIS_TOOLS_DIR ghi đè được). */
export function toolsDir() {
  const override = String(process.env.IRIS_TOOLS_DIR || "").trim();
  return override || path.join(unpackedRepoRoot(), "tools");
}

/** Lệnh Python: IRIS_PYTHON_BIN → dò python/py/python3 (resolvePythonCommand). */
export function pythonBin() {
  return resolvePythonCommand();
}

let userDataOverride = null;
/** main.mjs gọi một lần lúc khởi động: setUserDataDir(app.getPath("userData")). */
export function setUserDataDir(dir) {
  if (typeof dir === "string" && dir) userDataOverride = dir;
}
/** Nơi ghi dữ liệu runtime (ảnh chụp, log, bản ghi họp...). Gói đã đóng có repoRoot chỉ-đọc. */
export function userDataDir() {
  return userDataOverride || String(process.env.IRIS_USER_DATA || "").trim() || path.join(repoRoot, ".iris-data");
}
