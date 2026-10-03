/**
 * electron/main/device-config.mjs
 *
 * Cached readers for robots.json / smarthome_cameras.json config files.
 * Used by the vision loops, the robot/smart-home action tools, and the
 * Claude tool dispatcher.
 *
 * Thứ tự đọc: `<tên>.json` (file thật của người dùng, đã .gitignore) →
 * `<tên>.example.json` (bản mẫu có trong repo, KHÔNG chứa token). Thư mục đọc:
 * IRIS_CONFIG_DIR hoặc repoRoot.
 *
 * Module thuần (không import electron): cảnh báo đi qua setConfigWarningHandler()
 * để main.mjs chuyển thành emitEvent (UI thấy được thay vì chỉ console.error).
 */
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";

let warnHandler = (msg) => console.warn(msg);
export function setConfigWarningHandler(fn) {
  warnHandler = typeof fn === "function" ? fn : () => {};
}
const warnedOnce = new Set();
function warn(key, msg) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  try { warnHandler(msg); } catch { /* ignore */ }
}

function configDir() {
  return String(process.env.IRIS_CONFIG_DIR || "").trim() || repoRoot;
}

const CACHE_MS = 5000;
const caches = new Map(); // name -> { value, time }

function readConfig(name, rootKey) {
  const hit = caches.get(name);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.value;

  const dir = configDir();
  const real = path.join(dir, `${name}.json`);
  const example = path.join(dir, `${name}.example.json`);
  let file = null;
  if (fs.existsSync(real)) file = real;
  else if (fs.existsSync(example)) {
    file = example;
    warn(`${name}:example`, `[config] ${name}.json chưa có — đang dùng bản mẫu ${name}.example.json (sao chép thành ${name}.json và điền thông tin thật).`);
  }

  let value = {};
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      value = (parsed && typeof parsed === "object" && parsed[rootKey]) || {};
    } catch (err) {
      value = {};
      // Cảnh báo mỗi lần nội dung hỏng (khoá theo mtime để không spam mỗi 5 s).
      let mtime = 0;
      try { mtime = fs.statSync(file).mtimeMs; } catch { /* ignore */ }
      warn(`${name}:parse:${mtime}`, `[config] Không đọc được ${path.basename(file)}: ${err.message}`);
    }
  }
  caches.set(name, { value, time: Date.now() });
  return value;
}

/** Xoá cache (dùng trong test hoặc sau khi người dùng sửa file). */
export function resetDeviceConfigCache() {
  caches.clear();
  warnedOnce.clear();
}

export function getRobotsConfig() {
  return readConfig("robots", "robots");
}

export function getSmartHomeCamerasConfig() {
  return readConfig("smarthome_cameras", "cameras");
}
