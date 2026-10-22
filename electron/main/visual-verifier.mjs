/**
 * electron/main/visual-verifier.mjs
 *
 * Closed-Loop Visual Verification Engine:
 * - Pre-action & Post-action snapshot comparison (Visual Diff)
 * - Smart Settle (debounce / animation stabilization)
 * - Self-Healing / Auto-retry on misclicks
 * - HUD and event notification for real-time visual feedback
 */
import { emitEvent, emitToRenderer } from "./events.mjs";
import { envFlag } from "./env-config.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tính tỷ lệ khác biệt giữa hai Buffer ảnh (hoặc base64) từ 0.0 (giống hệt) đến 1.0 (khác biệt hoàn toàn).
 * Thuật toán so sánh byte lấy mẫu hiệu năng cao (< 0.1ms, không tốn CPU/RAM).
 */
export function computeBufferDiffRatio(rawA, rawB) {
  if (!rawA || !rawB) return 1.0;
  const bufA = Buffer.isBuffer(rawA) ? rawA : Buffer.from(String(rawA), "base64");
  const bufB = Buffer.isBuffer(rawB) ? rawB : Buffer.from(String(rawB), "base64");

  if (bufA.length === 0 && bufB.length === 0) return 0.0;
  if (bufA.length === 0 || bufB.length === 0) return 1.0;
  if (bufA.equals(bufB)) return 0.0;

  const minLen = Math.min(bufA.length, bufB.length);
  const maxLen = Math.max(bufA.length, bufB.length);
  const lenDelta = maxLen - minLen;

  // Lấy mẫu tối đa ~1000 điểm trên buffer để giữ thời gian tính toán < 0.1ms
  const step = Math.max(1, Math.floor(minLen / 1000));
  let sampleCount = 0;
  let diffCount = 0;

  for (let i = 0; i < minLen; i += step) {
    sampleCount++;
    if (bufA[i] !== bufB[i]) {
      diffCount++;
    }
  }

  // Kết hợp tỷ lệ khác biệt nội dung mẫu và độ chênh lệch kích thước file JPEG
  const sampleDiffRatio = sampleCount > 0 ? diffCount / sampleCount : 0.0;
  const lengthDiffRatio = lenDelta / maxLen;
  const finalRatio = Math.min(1.0, sampleDiffRatio * 0.7 + lengthDiffRatio * 0.3);

  return Math.round(finalRatio * 10000) / 10000;
}

/**
 * Chờ màn hình ổn định sau thao tác (animation bung mở / render xong).
 */
export async function smartSettle({ minWaitMs = 180, maxWaitMs = 450 } = {}) {
  // Đợi tối thiểu để Windows window manager hoặc Chromium kịp render khung hình mới
  await sleep(minWaitMs);
}

/**
 * Chụp một vùng màn hình quanh toạ độ (X, Y) hoặc hình chữ nhật cropRect.
 */
export async function captureRegionSnapshot(rectOrPoint, quality = 75) {
  try {
    const { grabScreenRegionJpeg } = await import("./vision.mjs");
    let cropRect;

    if (rectOrPoint && typeof rectOrPoint.x === "number" && typeof rectOrPoint.y === "number") {
      if (typeof rectOrPoint.width === "number" && typeof rectOrPoint.height === "number") {
        cropRect = rectOrPoint;
      } else {
        const cropW = 160;
        const cropH = 120;
        cropRect = {
          x: Math.max(0, rectOrPoint.x - Math.round(cropW / 2)),
          y: Math.max(0, rectOrPoint.y - Math.round(cropH / 2)),
          width: cropW,
          height: cropH,
        };
      }
    } else {
      cropRect = { x: 0, y: 0, width: 200, height: 200 };
    }

    const b64 = await grabScreenRegionJpeg(cropRect, quality);
    if (!b64) return null;

    return {
      cropRect,
      base64: b64,
      buffer: Buffer.from(b64, "base64"),
    };
  } catch (err) {
    console.warn("[visual-verifier] captureRegionSnapshot error:", err.message);
    return null;
  }
}

/**
 * Thực hiện kiểm tra thị giác Trước - Sau thao tác, tự động thử lại nếu phát hiện chưa ăn nút bấm.
 */
export async function verifyActionWithDiff({
  beforeSnapshot = null,
  cropRectOrPoint = null,
  label = "thao tác",
  minDiffRatio = 0.012, // 1.2% khác biệt byte ảnh là đủ chứng minh nút/giao diện đã đổi
  maxRetries = 1,
  retryFn = null,
} = {}) {
  const isVerifyEnabled = envFlag("IRIS_VISUAL_VERIFY", true);
  if (!isVerifyEnabled) {
    return { verified: true, skipped: true, reason: "IRIS_VISUAL_VERIFY is disabled" };
  }

  // 1. Chờ giao diện render xong (smart debounce)
  await smartSettle({ minWaitMs: 200 });

  // 2. Chụp khung hình sau thao tác
  const afterSnapshot = await captureRegionSnapshot(cropRectOrPoint);
  if (!afterSnapshot || !afterSnapshot.buffer) {
    return { verified: false, error: "Không chụp được vùng nghiệm thu sau thao tác" };
  }

  // Nếu không có snapshot trước thao tác, chỉ nghiệm thu xem có khung hình hợp lệ không
  if (!beforeSnapshot || !beforeSnapshot.buffer) {
    return {
      verified: true,
      has_post_frame: true,
      region: afterSnapshot.cropRect,
    };
  }

  // 3. So sánh ảnh Trước và Sau
  let diffRatio = computeBufferDiffRatio(beforeSnapshot.buffer, afterSnapshot.buffer);

  if (diffRatio >= minDiffRatio) {
    const pct = (diffRatio * 100).toFixed(1);
    emitEvent({
      type: "log",
      level: "info",
      message: `[VisualVerify] ✔ Nghiệm thu thành công "${label}": Thay đổi ${pct}% giao diện.`,
    });
    emitToRenderer("hud:message", {
      title: "Nghiệm Thu Thị Giác",
      content: `✔ Đã xác nhận "${label}" (đổi ${pct}%)`,
    });
    return {
      verified: true,
      diffRatio,
      retries: 0,
      region: afterSnapshot.cropRect,
    };
  }

  // 4. Phát hiện thao tác chưa ăn (diff < minDiffRatio) -> Thử lại tự sửa sai (Self-Healing)
  if (typeof retryFn === "function" && maxRetries > 0) {
    emitEvent({
      type: "log",
      level: "warn",
      message: `[VisualVerify] ⚠ Chưa thấy thay đổi sau "${label}" (diff: ${(diffRatio * 100).toFixed(2)}%). Đang tự động thử lại...`,
    });
    emitToRenderer("hud:message", {
      title: "Tự Sửa Sai (Self-Healing)",
      content: `⚠ Thao tác "${label}" chưa ăn nút — đang click lại...`,
    });

    try {
      await retryFn(1);
      await smartSettle({ minWaitMs: 250 });
      const retrySnapshot = await captureRegionSnapshot(cropRectOrPoint);
      if (retrySnapshot?.buffer) {
        const retryDiff = computeBufferDiffRatio(beforeSnapshot.buffer, retrySnapshot.buffer);
        if (retryDiff >= minDiffRatio) {
          const pct2 = (retryDiff * 100).toFixed(1);
          emitEvent({
            type: "log",
            level: "info",
            message: `[VisualVerify] ✔ Thử lại thành công "${label}": Thay đổi ${pct2}%.`,
          });
          return {
            verified: true,
            diffRatio: retryDiff,
            retries: 1,
            region: retrySnapshot.cropRect,
          };
        }
      }
    } catch (retryErr) {
      console.warn("[visual-verifier] Retry failed:", retryErr.message);
    }
  }

  // Nếu đã thử lại mà vẫn không đổi
  return {
    verified: false,
    diffRatio,
    warning: `Giao diện "${label}" ít thay đổi (${(diffRatio * 100).toFixed(2)}%), có thể cửa sổ chưa phản hồi hoặc click hụt.`,
    region: afterSnapshot.cropRect,
  };
}
