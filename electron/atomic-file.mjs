import fs from "node:fs";

// Atomic replace: write to a pid-suffixed temp file, then rename onto the
// target. rename is atomic within a filesystem, so a crash mid-write can
// never leave the target truncated — see design.md D1 of
// harden-config-persistence.
export function writeFileAtomicSync(file, data, opts) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, opts);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
}

// Async counterpart for callers on the hot path (e.g. the canvas scene
// persist, which can be multi-MB with embedded images) — the sync variant
// would block the main-process event loop and jank the 24kHz audio IPC. See
// design.md D5 of hud-drawing-canvas.
export async function writeFileAtomicAsync(file, data, opts) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(tmp, data, opts);
    await fs.promises.rename(tmp, file);
  } catch (err) {
    try {
      await fs.promises.rm(tmp, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
}

// Move an unreadable/corrupt file aside so its bytes survive rather than
// being silently discarded by the next overwrite — see design.md D2.
export function quarantineFile(file) {
  const quarantined = `${file}.corrupt-${Date.now()}`;
  fs.renameSync(file, quarantined);
  return quarantined;
}

/**
 * Đọc JSON; nếu file hỏng (cụt do crash, sai cú pháp) thì CÁCH LY nó (`<file>.corrupt-<ts>`) để dữ liệu
 * còn nằm đó thay vì bị ghi đè bởi lần lưu kế tiếp (E-02). File chưa tồn tại => fallback, không cách ly.
 * @returns {{ value: any, quarantinedTo: string|null, error: Error|null }}
 */
export function readJsonOrQuarantine(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { value: fallback, quarantinedTo: null, error: null };
    return { value: fallback, quarantinedTo: null, error: err };
  }
  try {
    return { value: JSON.parse(text.replace(/^\uFEFF/, "")), quarantinedTo: null, error: null };
  } catch (error) {
    let quarantinedTo = null;
    try {
      quarantinedTo = quarantineFile(file);
    } catch {
      /* không cách ly được: vẫn trả fallback */
    }
    return { value: fallback, quarantinedTo, error };
  }
}
