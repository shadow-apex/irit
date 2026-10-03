/**
 * electron/main/live-input.mjs
 *
 * V-01: dựng đúng payload cho `session.sendRealtimeInput()` của @google/genai.
 *
 * SDK chỉ đọc params.video / params.audio / params.text (và `media` đã deprecated).
 * Truyền MẢNG `[{mimeType,data}]` làm message gửi đi trở thành `{"realtimeInput":{}}`
 * — tức là KHÔNG frame nào tới Gemini dù mọi tool vẫn báo thành công.
 *
 * Module thuần (không import electron).
 */

/** Nhận diện MIME ảnh từ vài byte đầu của chuỗi base64; null nếu không phải JPEG/PNG/WebP. */
export function detectImageMime(b64) {
  if (typeof b64 !== "string" || b64.length < 8) return null;
  const h = Buffer.from(b64.slice(0, 24), "base64");
  if (h[0] === 0xff && h[1] === 0xd8) return "image/jpeg";
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return "image/png";
  if (h.subarray(0, 4).toString("ascii") === "RIFF") return "image/webp";
  return null;
}

/** Bỏ tiền tố `data:image/...;base64,` nếu có. */
export function stripDataUrl(input) {
  if (typeof input !== "string") return "";
  const i = input.indexOf(",");
  return input.startsWith("data:") && i >= 0 ? input.slice(i + 1) : input;
}

/**
 * @returns {{video:{data:string,mimeType:string}}|null}
 * KHÔNG dùng mảng, KHÔNG dùng `media` (deprecated).
 */
export function buildVideoInput(b64, mimeType) {
  if (typeof b64 !== "string" || !b64) return null;
  const mt = mimeType || detectImageMime(b64);
  if (!mt) return null;
  return { video: { data: b64, mimeType: mt } };
}
