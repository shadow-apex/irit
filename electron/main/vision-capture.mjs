/**
 * electron/main/vision-capture.mjs
 *
 * Phần THUẦN (không import electron / gemini-live) của tầng vision — tách riêng để test:
 *   - grabJpeg():     lấy ĐÚNG MỘT ảnh JPEG từ URL snapshot HOẶC luồng MJPEG vô hạn (V-02)
 *   - createFrameLoop(): vòng lặp chụp→gửi dùng chung cho cả 4 nguồn (V-02, V-03)
 */
import crypto from "node:crypto";

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/**
 * Lấy một frame JPEG. `await fetch(url)+arrayBuffer()` treo vĩnh viễn trên luồng
 * MJPEG (multipart/x-mixed-replace) nên phải đọc stream và cắt đúng một frame.
 * Luôn có timeout và giới hạn kích thước.
 */
export async function grabJpeg(url, { timeoutMs = 5000, maxBytes = 4_000_000, fetchImpl = fetch } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let result = null;
  try {
    const res = await fetchImpl(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!/multipart\/x-mixed-replace/i.test(ct)) {
      // Snapshot thường (1 ảnh)
      if (Number(res.headers.get("content-length") || 0) > maxBytes) throw new Error("snapshot too large");
      const b = Buffer.from(await res.arrayBuffer());
      if (b.length > maxBytes) throw new Error("snapshot too large");
      return b;
    }
    // MJPEG: cắt đúng 1 frame. KHÔNG abort() trong vòng lặp rồi return — sẽ reject AbortError;
    // phải `break` rồi mới abort ở finally.
    let buf = Buffer.alloc(0);
    try {
      for await (const chunk of res.body) {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length > maxBytes) throw new Error("frame too large");
        const s = buf.indexOf(SOI);
        if (s < 0) {
          buf = buf.subarray(Math.max(0, buf.length - 1));
          continue;
        }
        const e = buf.indexOf(EOI, s + 2);
        if (e < 0) continue;
        result = Buffer.from(buf.subarray(s, e + 2));
        break;
      }
    } catch (err) {
      if (!result) throw err; // abort sau khi đã có frame là bình thường
    }
    if (!result) throw new Error("stream ended without a frame");
    return result;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

export function visionIntervalMs(env = process.env) {
  return Math.max(1000, Number(env.IRIS_VISION_INTERVAL_MS) || 4000);
}

/**
 * Vòng lặp frame dùng chung.
 *  - KHÔNG tự tắt khi chưa có phiên Gemini (đang reconnect): chỉ bỏ qua tick (V-03).
 *  - Cờ in-flight: không chồng request (V-02).
 *  - Sau N lỗi capture liên tiếp: dừng CÓ báo (không im lặng).
 *  - Dedupe SHA-1; reset khi phiên Gemini mới (phiên mới chưa từng thấy frame cũ).
 *
 * @returns {{ id: any, stop: () => void, tick: () => Promise<void> }}
 */
export function createFrameLoop({
  label,
  capture, // () => Promise<Buffer>
  isActive, // () => boolean
  hasSession, // () => boolean
  send, // (base64, mime) => boolean
  emit = () => {},
  onStop = () => {},
  intervalMs = visionIntervalMs(),
  maxFailures = 5,
}) {
  let inFlight = false;
  let failures = 0;
  let lastHash = null;
  let sessionWasLost = false;

  async function tick() {
    if (!isActive()) return;
    if (!hasSession()) {
      sessionWasLost = true; // đang reconnect: bỏ qua tick, GIỮ vòng lặp
      return;
    }
    if (sessionWasLost) {
      lastHash = null;
      sessionWasLost = false;
    }
    if (inFlight) return;
    inFlight = true;
    try {
      const jpeg = await capture();
      failures = 0;
      const hash = crypto.createHash("sha1").update(jpeg).digest("hex");
      if (hash === lastHash) return;
      const ok = send(jpeg.toString("base64"), "image/jpeg");
      if (ok) lastHash = hash; // chỉ nhớ hash khi thực sự đã gửi được
    } catch (e) {
      failures++;
      if (failures === 1 || failures % 15 === 0) {
        emit({ type: "log", level: "warn", message: `[${label}] capture failed: ${e.message}` });
      }
      if (failures >= maxFailures) {
        emit({ type: "log", level: "error", message: `[${label}] không lấy được hình ${failures} lần liên tiếp — đã dừng vision.` });
        failures = 0;
        onStop();
      }
    } finally {
      inFlight = false;
    }
  }

  const id = setInterval(tick, intervalMs);
  return {
    id,
    tick,
    stop() {
      clearInterval(id);
    },
  };
}
