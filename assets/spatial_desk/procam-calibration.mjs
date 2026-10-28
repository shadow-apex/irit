/**
 * assets/spatial_desk/procam-calibration.mjs
 *
 * Ma trận chuyển đổi toạ độ Camera - Máy chiếu (ProCam Homography Calibration)
 * Kế thừa mô hình toán học từ Microsoft RoomAliveToolkit:
 *  - Giải ma trận Homography 3x3 (8 bậc tự do) ánh xạ mặt phẳng Camera Overhead -> Mặt bàn Máy chiếu.
 *  - Chuyển đổi hai chiều (Camera <-> Projector Desk) và chuẩn hoá tỉ lệ Pixels-Per-Metric (PPM) chuẩn milimet.
 *  - Xử lý toạ độ bàn tay MediaPipe (THUMB_TIP #4 + INDEX_FINGER_TIP #8) cho cảm ứng chạm & Pinch-to-Zoom trên mặt bàn.
 */

// Kích thước chuẩn quốc tế ISO/IEC 7810 ID-1 (Thẻ ATM / Căn cước) dùng làm vật chuẩn khoá tỉ lệ milimet
export const ISO_CARD_WIDTH_MM = 85.6;
export const ISO_CARD_HEIGHT_MM = 53.98;
export const DEFAULT_PPM = 4.25; // Pixels-per-millimeter mặc định ở độ phân giải 1920x1080 chiếu mặt bàn ~45cm

// Điểm mốc 4 góc mặc định (Camera chuẩn hoá [0..1] -> Projector chuẩn hoá [0..1])
export const DEFAULT_CALIBRATION_POINTS = Object.freeze({
  cameraQuad: [
    { x: 0.08, y: 0.08 }, // Top-Left
    { x: 0.92, y: 0.08 }, // Top-Right
    { x: 0.92, y: 0.92 }, // Bottom-Right
    { x: 0.08, y: 0.92 }, // Bottom-Left
  ],
  projectorQuad: [
    { x: 0.0, y: 0.0 },
    { x: 1.0, y: 0.0 },
    { x: 1.0, y: 1.0 },
    { x: 0.0, y: 1.0 },
  ],
});

/**
 * Ma trận đơn vị 3x3 (dạng mảng phẳng 9 phần tử theo hàng).
 */
export function identityMatrix3x3() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/**
 * Giải hệ phương trình tuyến tính A * x = b bằng phép khử Gauss có chọn phần tử trụ (Partial Pivoting).
 * @param {number[][]} A Ma trận vuông n x n
 * @param {number[]} b Vector vế phải độ dài n
 * @returns {number[] | null} Nghiệm x hoặc null nếu ma trận suy biến
 */
export function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const absVal = Math.abs(M[row][col]);
      if (absVal > maxVal) {
        maxVal = absVal;
        pivotRow = row;
      }
    }
    if (maxVal < 1e-11) return null;

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let j = col; j <= n; j++) {
      M[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Tính ma trận Homography 3x3 ánh xạ từ 4 điểm nguồn (Camera) sang 4 điểm đích (Projector/Desk).
 * @param {Array<{x:number, y:number}>} srcPoints 4 điểm trên hệ toạ độ Camera
 * @param {Array<{x:number, y:number}>} dstPoints 4 điểm tương ứng trên mặt phẳng Máy chiếu
 * @returns {number[]} Ma trận 3x3 dạng mảng 9 phần tử [h00, h01, h02, h10, h11, h12, h20, h21, h22]
 */
export function solveHomography(srcPoints, dstPoints) {
  if (!Array.isArray(srcPoints) || !Array.isArray(dstPoints) || srcPoints.length < 4 || dstPoints.length < 4) {
    return identityMatrix3x3();
  }

  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const x = Number(srcPoints[i].x) || 0;
    const y = Number(srcPoints[i].y) || 0;
    const X = Number(dstPoints[i].x) || 0;
    const Y = Number(dstPoints[i].y) || 0;

    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }

  const h = solveLinearSystem(A, b);
  if (!h) return identityMatrix3x3();
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Nghịch đảo ma trận Homography 3x3 (Projector -> Camera).
 * @param {number[]} H Ma trận 3x3 (9 phần tử)
 * @returns {number[]} Ma trận nghịch đảo 3x3
 */
export function invertHomography(H) {
  if (!Array.isArray(H) || H.length !== 9) return identityMatrix3x3();
  const [a, b, c, d, e, f, g, h, i] = H;

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H_cof = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return identityMatrix3x3();

  const invDet = 1 / det;
  return [
    A * invDet, D * invDet, G * invDet,
    B * invDet, E * invDet, H_cof * invDet,
    C * invDet, F * invDet, I * invDet,
  ];
}

/**
 * Áp dụng phép biến đổi Homography cho điểm (x, y).
 * @param {number[]} H Ma trận 3x3 (9 phần tử)
 * @param {number} x
 * @param {number} y
 * @returns {{x: number, y: number}}
 */
export function applyHomography(H, x, y) {
  if (!Array.isArray(H) || H.length !== 9) return { x, y };
  const denom = H[6] * x + H[7] * y + H[8];
  if (Math.abs(denom) < 1e-9) return { x, y };
  return {
    x: (H[0] * x + H[1] * y + H[2]) / denom,
    y: (H[3] * x + H[4] * y + H[5]) / denom,
  };
}

/**
 * Tính tỉ lệ Pixels-Per-Millimeter (PPM) từ 2 điểm đo trên ảnh/bàn so với kích thước thực (mm).
 * @param {{x:number, y:number}} p1
 * @param {{x:number, y:number}} p2
 * @param {number} realDistanceMm Mặc định chiều dài thẻ ATM chuẩn 85.60mm
 */
export function computePixelsPerMillimeter(p1, p2, realDistanceMm = ISO_CARD_WIDTH_MM) {
  if (!p1 || !p2 || !(realDistanceMm > 0)) return DEFAULT_PPM;
  const distPx = Math.hypot((Number(p2.x) || 0) - (Number(p1.x) || 0), (Number(p2.y) || 0) - (Number(p1.y) || 0));
  if (distPx <= 1) return DEFAULT_PPM;
  return Number((distPx / realDistanceMm).toFixed(4));
}

/**
 * Đổi khoảng cách pixel trên mặt bàn sang milimet thực tế.
 */
export function pixelsToMillimeters(px, ppm = DEFAULT_PPM) {
  const safePpm = ppm > 0 ? ppm : DEFAULT_PPM;
  return Number((px / safePpm).toFixed(2));
}

/**
 * Đổi milimet thực tế sang số pixel hiển thị trên mặt bàn máy chiếu.
 */
export function millimetersToPixels(mm, ppm = DEFAULT_PPM) {
  const safePpm = ppm > 0 ? ppm : DEFAULT_PPM;
  return Number((mm * safePpm).toFixed(2));
}

/**
 * Phân tích cử chỉ bàn tay MediaPipe (THUMB_TIP #4 và INDEX_FINGER_TIP #8)
 * sau khi ánh xạ qua Homography sang toạ độ mặt bàn máy chiếu.
 *
 * @param {Array<{x:number, y:number}>} landmarks Mảng 21 điểm mốc bàn tay từ MediaPipe (toạ độ chuẩn hoá 0..1)
 * @param {number[]} H Ma trận Homography Camera -> Projector (chuẩn hoá 0..1)
 * @param {{width:number, height:number}} deskSize Kích thước vùng chiếu (px)
 * @param {{baseDistancePx?: number, baseScale?: number}} [pinchSession] Trạng thái pinch trước đó
 */
export function evaluateHandPinchAndTouch(landmarks, H, deskSize = { width: 1920, height: 1080 }, pinchSession = {}) {
  if (!Array.isArray(landmarks) || landmarks.length < 9) {
    return null;
  }
  const thumbTip = landmarks[4]; // THUMB_TIP
  const indexTip = landmarks[8]; // INDEX_FINGER_TIP
  if (!thumbTip || !indexTip) return null;

  const projThumbNorm = applyHomography(H, Number(thumbTip.x) || 0, Number(thumbTip.y) || 0);
  const projIndexNorm = applyHomography(H, Number(indexTip.x) || 0, Number(indexTip.y) || 0);

  const width = Math.max(1, Number(deskSize?.width) || 1920);
  const height = Math.max(1, Number(deskSize?.height) || 1080);

  const thumbPx = {
    x: Math.round(Math.max(0, Math.min(1, projThumbNorm.x)) * width),
    y: Math.round(Math.max(0, Math.min(1, projThumbNorm.y)) * height),
  };
  const indexPx = {
    x: Math.round(Math.max(0, Math.min(1, projIndexNorm.x)) * width),
    y: Math.round(Math.max(0, Math.min(1, projIndexNorm.y)) * height),
  };

  const centerPx = {
    x: Math.round((thumbPx.x + indexPx.x) / 2),
    y: Math.round((thumbPx.y + indexPx.y) / 2),
  };

  const pinchDistancePx = Math.hypot(indexPx.x - thumbPx.x, indexPx.y - thumbPx.y);
  const normalizedPinchDist = Math.hypot(
    projIndexNorm.x - projThumbNorm.x,
    projIndexNorm.y - projThumbNorm.y,
  );

  // Chạm ngón trỏ (Touch/Drag) khi khoảng cách chụm nhỏ (< 0.055) hoặc chụm 2 ngón để kéo;
  // Pinch-to-Zoom khi 2 ngón tách/chụm trong vùng tương tác (0.03 .. 0.32)
  const isTouching = normalizedPinchDist < 0.055;
  const isPinchZoomActive = normalizedPinchDist >= 0.03 && normalizedPinchDist <= 0.32;

  let scale = Number(pinchSession?.baseScale) || 1.0;
  if (isPinchZoomActive && pinchSession?.baseDistancePx > 10) {
    const ratio = pinchDistancePx / pinchSession.baseDistancePx;
    scale = Math.max(0.4, Math.min(3.0, Number(((pinchSession.baseScale || 1.0) * ratio).toFixed(3))));
  }

  return {
    thumbTip: thumbPx,
    indexTip: indexPx,
    center: centerPx,
    pinchDistancePx: Number(pinchDistancePx.toFixed(1)),
    normalizedPinchDist: Number(normalizedPinchDist.toFixed(4)),
    isTouching,
    isPinchZoomActive,
    scale,
  };
}

/**
 * Bộ quản lý trạng thái Hiệu chuẩn Máy chiếu - Camera (ProCamCalibrator).
 */
export class ProCamCalibrator {
  constructor(options = {}) {
    this.cameraQuad = options.cameraQuad || DEFAULT_CALIBRATION_POINTS.cameraQuad;
    this.projectorQuad = options.projectorQuad || DEFAULT_CALIBRATION_POINTS.projectorQuad;
    this.ppm = Number(options.ppm) > 0 ? Number(options.ppm) : DEFAULT_PPM;
    this.homography = solveHomography(this.cameraQuad, this.projectorQuad);
    this.inverseHomography = invertHomography(this.homography);
  }

  updateCalibration({ cameraQuad, projectorQuad, ppm } = {}) {
    if (Array.isArray(cameraQuad) && cameraQuad.length >= 4) {
      this.cameraQuad = cameraQuad.slice(0, 4);
    }
    if (Array.isArray(projectorQuad) && projectorQuad.length >= 4) {
      this.projectorQuad = projectorQuad.slice(0, 4);
    }
    if (Number(ppm) > 0) {
      this.ppm = Number(ppm);
    }
    this.homography = solveHomography(this.cameraQuad, this.projectorQuad);
    this.inverseHomography = invertHomography(this.homography);
    return this.getSnapshot();
  }

  cameraToProjector(u, v, deskBounds = { x: 0, y: 0, width: 1920, height: 1080 }) {
    const mapped = applyHomography(this.homography, u, v);
    return {
      nx: mapped.x,
      ny: mapped.y,
      x: Math.round((deskBounds.x || 0) + mapped.x * (deskBounds.width || 1920)),
      y: Math.round((deskBounds.y || 0) + mapped.y * (deskBounds.height || 1080)),
    };
  }

  projectorToCamera(nx, ny) {
    return applyHomography(this.inverseHomography, nx, ny);
  }

  getSnapshot() {
    return {
      ppm: this.ppm,
      cameraQuad: this.cameraQuad,
      projectorQuad: this.projectorQuad,
      homography: this.homography,
      inverseHomography: this.inverseHomography,
    };
  }
}
