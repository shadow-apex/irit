// src/lib/frameCapture.ts
//
// Lấy một khung JPEG từ <video> cho mọi tính năng vision của renderer (desk snap, desk
// liên tục, camera-stream). Trước đây mỗi nơi tự vẽ ở độ phân giải gốc với chất lượng
// lẻ (0.2 → ảnh vỡ không đọc được chữ; 0.5–0.6 → full-res nặng) — nay thống nhất:
// thu nhỏ cạnh dài tối đa `maxSide` và nén JPEG `quality`.

export function videoToJpegDataUrl(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxSide = 1024,
  quality = 0.7,
): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const s = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
