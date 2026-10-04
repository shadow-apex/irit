/**
 * electron/main/screenshot-store.mjs
 *
 * TL-11: lưu ảnh chụp màn hình CHỈ khi được yêu cầu, vào <userData>/screenshots, và dọn tự động
 * (giữ ≤ 20 ảnh mới nhất, xoá ảnh > 24 giờ). Module thuần (fs + path).
 */
import fs from "node:fs";
import path from "node:path";

export const MAX_KEEP = 20;
export const MAX_AGE_MS = 24 * 3600 * 1000;

/** Hàm thuần: danh sách tên file cần xoá, cho [{name, mtimeMs}]. */
export function pickStale(entries, now = Date.now(), { maxKeep = MAX_KEEP, maxAgeMs = MAX_AGE_MS } = {}) {
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sorted.filter((e, i) => i >= maxKeep || now - e.mtimeMs > maxAgeMs).map((e) => e.name);
}

export function cleanupScreenshots(dir, now = Date.now(), opts) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    if (!/^screenshot_.*\.(jpe?g|png)$/i.test(name)) continue;
    try {
      entries.push({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs });
    } catch {
      /* bỏ qua */
    }
  }
  const stale = pickStale(entries, now, opts);
  for (const n of stale) {
    try {
      fs.rmSync(path.join(dir, n), { force: true });
    } catch {
      /* bỏ qua */
    }
  }
  return stale;
}

/** Ghi JPEG vào dir rồi dọn; trả về đường dẫn tuyệt đối. */
export function saveScreenshot(dir, jpegBuffer, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const file = path.join(dir, `screenshot_${stamp}_${String(now.getMilliseconds()).padStart(3, "0")}.jpg`);
  fs.writeFileSync(file, jpegBuffer, { mode: 0o600 });
  cleanupScreenshots(dir, now.getTime());
  return file;
}
