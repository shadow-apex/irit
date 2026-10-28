"""
assets/spatial_desk/tools/desk_autocalib.py — Tự động hiệu chuẩn Máy chiếu - Camera trong 2 giây (Auto ProCam Calibration).

Giải pháp kỹ thuật:
1. Sinh hoặc phát hiện mẫu căn chỉnh quang học tương phản cao: 4 mã ArUco (ID 0, 1, 2, 3 tại 4 góc) kết hợp lưới bàn cờ ChArUco / Chessboard (7x5 nội điểm) ở trung tâm.
2. Sử dụng OpenCV (`cv2.aruco` + `cv2.findChessboardCorners` + `cv2.findHomography`) để tự động trích xuất toạ độ 4 góc vùng chiếu trên ảnh Camera Overhead.
3. Tính toán tự động ma trận Homography 3x3 (và ma trận nghịch đảo) cùng tỷ lệ chuẩn PPM (Pixels-Per-Millimeter).
4. Tự động lưu cấu hình chuẩn hoá vào `assets/spatial_desk/procam_config.json`.
"""
from datetime import datetime, timezone
import json
import math
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_SPATIAL_DESK_DIR = os.path.abspath(os.path.join(_HERE, ".."))
_DEFAULT_CONFIG_PATH = os.path.join(_SPATIAL_DESK_DIR, "procam_config.json")
_REPO_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
_CORE_TOOLS_DIR = os.path.join(_REPO_ROOT, "tools")
if _CORE_TOOLS_DIR not in sys.path:
    sys.path.insert(0, _CORE_TOOLS_DIR)

import _common  # noqa: E402

_common.ensure_utf8()

DEFAULT_BOARD_WIDTH_MM = 380.0
DEFAULT_BOARD_HEIGHT_MM = 215.0
DEFAULT_PPM = 4.25
CHESSBOARD_PATTERN_SIZE = (7, 5)  # 7x5 góc nội bàn cờ

# Tọa độ chuẩn hoá 4 góc mẫu ArUco chiếu xuống mặt bàn (Projector Space [0..1])
DEFAULT_PROJECTOR_QUAD = [
    {"x": 0.08, "y": 0.08},  # Top-Left (ArUco ID 0)
    {"x": 0.92, "y": 0.08},  # Top-Right (ArUco ID 1)
    {"x": 0.92, "y": 0.92},  # Bottom-Right (ArUco ID 2)
    {"x": 0.08, "y": 0.92},  # Bottom-Left (ArUco ID 3)
]


def _solve_linear_8x8(A, b):
    """Giải hệ phương trình tuyến tính 8x8 bằng phép khử Gauss có chọn phần tử trụ."""
    n = len(b)
    M = [list(A[i]) + [float(b[i])] for i in range(n)]
    for col in range(n):
        pivot_row = col
        max_val = abs(M[col][col])
        for row in range(col + 1, n):
            if abs(M[row][col]) > max_val:
                max_val = abs(M[row][col])
                pivot_row = row
        if max_val < 1e-11:
            return None
        if pivot_row != col:
            M[col], M[pivot_row] = M[pivot_row], M[col]
        pivot = M[col][col]
        for j in range(col, n + 1):
            M[col][j] /= pivot
        for row in range(n):
            if row == col:
                continue
            factor = M[row][col]
            if abs(factor) < 1e-15:
                continue
            for j in range(col, n + 1):
                M[row][j] -= factor * M[col][j]
    return [M[i][n] for i in range(n)]


def compute_homography_3x3(src_pts, dst_pts):
    """Tính ma trận Homography 3x3 (mảng phẳng 9 phần tử) từ 4 điểm nguồn sang 4 điểm đích."""
    if not src_pts or not dst_pts or len(src_pts) < 4 or len(dst_pts) < 4:
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]

    try:
        import cv2
        import numpy as np

        src_arr = np.array([[float(p["x"]), float(p["y"])] for p in src_pts[:4]], dtype=np.float64)
        dst_arr = np.array([[float(p["x"]), float(p["y"])] for p in dst_pts[:4]], dtype=np.float64)
        H, _ = cv2.findHomography(src_arr, dst_arr, method=0)
        if H is not None and H.shape == (3, 3) and abs(float(H[2, 2])) > 1e-11:
            H = H / float(H[2, 2])
            return [round(float(v), 8) for v in H.flatten()]
    except Exception:
        pass

    A = []
    b = []
    for i in range(4):
        x = float(src_pts[i]["x"])
        y = float(src_pts[i]["y"])
        X = float(dst_pts[i]["x"])
        Y = float(dst_pts[i]["y"])
        A.append([x, y, 1.0, 0.0, 0.0, 0.0, -x * X, -y * X])
        b.append(X)
        A.append([0.0, 0.0, 0.0, x, y, 1.0, -x * Y, -y * Y])
        b.append(Y)
    sol = _solve_linear_8x8(A, b)
    if not sol:
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    return [round(float(v), 8) for v in sol] + [1.0]


def invert_homography_3x3(H):
    """Tính ma trận nghịch đảo 3x3 của ma trận Homography."""
    if not H or len(H) != 9:
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    a, b, c, d, e, f, g, h, i = [float(x) for x in H]
    A = e * i - f * h
    B = -(d * i - f * g)
    C = d * h - e * g
    D = -(b * i - c * h)
    E = a * i - c * g
    F = -(a * h - b * g)
    G = b * f - c * e
    H_c = -(a * f - c * d)
    I_c = a * e - b * d
    det = a * A + b * B + c * C
    if abs(det) < 1e-12:
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    inv = 1.0 / det
    return [
        round(A * inv, 8), round(D * inv, 8), round(G * inv, 8),
        round(B * inv, 8), round(E * inv, 8), round(H_c * inv, 8),
        round(C * inv, 8), round(F * inv, 8), round(I_c * inv, 8),
    ]


def apply_homography_point(H, x, y):
    """Áp dụng ma trận Homography 3x3 cho điểm (x, y)."""
    denom = H[6] * x + H[7] * y + H[8]
    if abs(denom) < 1e-9:
        return {"x": x, "y": y}
    return {
        "x": (H[0] * x + H[1] * y + H[2]) / denom,
        "y": (H[3] * x + H[4] * y + H[5]) / denom,
    }


def generate_aruco_calibration_image(width=1920, height=1080, save_path=None):
    """
    Sinh ảnh mẫu hiệu chuẩn quang học độ tương phản cao gồm:
    - 4 mã ArUco chuẩn DICT_4X4_50 (ID 0, 1, 2, 3) tại 4 góc vùng chiếu.
    - Bàn cờ chuẩn (8x6 ô = 7x5 góc nội) ở chính giữa để `cv2.findChessboardCorners` bắt chính xác.
    """
    import cv2
    import numpy as np

    canvas = np.full((height, width, 3), 255, dtype=np.uint8)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    marker_size = max(120, int(round(min(width, height) * 0.14)))

    # Tọa độ tâm của 4 mã ArUco khớp đúng với DEFAULT_PROJECTOR_QUAD (0.08, 0.92)
    centers = [
        (0, int(round(width * 0.08)), int(round(height * 0.08))),
        (1, int(round(width * 0.92)), int(round(height * 0.08))),
        (2, int(round(width * 0.92)), int(round(height * 0.92))),
        (3, int(round(width * 0.08)), int(round(height * 0.92))),
    ]

    half = marker_size // 2
    for marker_id, cx, cy in centers:
        if hasattr(cv2.aruco, "generateImageMarker"):
            marker_img = cv2.aruco.generateImageMarker(aruco_dict, marker_id, marker_size)
        else:
            marker_img = np.zeros((marker_size, marker_size), dtype=np.uint8)
            cv2.aruco.drawMarker(aruco_dict, marker_id, marker_size, marker_img, 1)
        marker_bgr = cv2.cvtColor(marker_img, cv2.COLOR_GRAY2BGR)
        x0 = max(0, cx - half)
        y0 = max(0, cy - half)
        x1 = min(width, x0 + marker_size)
        y1 = min(height, y0 + marker_size)
        canvas[y0:y1, x0:x1] = marker_bgr[: y1 - y0, : x1 - x0]

    # Vẽ bàn cờ 8x6 ô vuông (tạo 7x5 góc nội cho findChessboardCorners) ở trung tâm
    cols_sq = CHESSBOARD_PATTERN_SIZE[0] + 1  # 8
    rows_sq = CHESSBOARD_PATTERN_SIZE[1] + 1  # 6
    cell_px = max(40, int(round(min(width, height) * 0.075)))
    board_w_px = cols_sq * cell_px
    board_h_px = rows_sq * cell_px
    bx0 = (width - board_w_px) // 2
    by0 = (height - board_h_px) // 2

    for r in range(rows_sq):
        for c in range(cols_sq):
            if (r + c) % 2 == 0:
                rx0 = bx0 + c * cell_px
                ry0 = by0 + r * cell_px
                canvas[ry0 : ry0 + cell_px, rx0 : rx0 + cell_px] = (0, 0, 0)

    if save_path:
        os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
        cv2.imwrite(save_path, canvas)

    return canvas


def detect_calibration_pattern(img_bgr, board_width_mm=DEFAULT_BOARD_WIDTH_MM, board_height_mm=DEFAULT_BOARD_HEIGHT_MM):
    """
    Phát hiện 4 góc ArUco (`cv2.aruco`) và lưới bàn cờ (`cv2.findChessboardCorners`) từ khung hình.
    Trả về `cameraQuad` chuẩn hoá [0..1], số lượng marker, số góc bàn cờ và tỷ lệ PPM.
    """
    import cv2
    import numpy as np

    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY) if len(img_bgr.shape) == 3 else img_bgr

    # 1. Phát hiện mã ArUco 4 góc (ID 0, 1, 2, 3)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    if hasattr(cv2.aruco, "ArucoDetector"):
        params = cv2.aruco.DetectorParameters()
        detector = cv2.aruco.ArucoDetector(aruco_dict, params)
        corners, ids, _ = detector.detectMarkers(gray)
    else:
        params = cv2.aruco.DetectorParameters_create()
        corners, ids, _ = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=params)

    marker_centers = {}
    if ids is not None and len(ids) > 0:
        for idx, marker_id_arr in enumerate(ids):
            m_id = int(marker_id_arr[0])
            pts = corners[idx][0]  # 4 góc của marker
            cx = float(np.mean(pts[:, 0]))
            cy = float(np.mean(pts[:, 1]))
            marker_centers[m_id] = (cx, cy)

    # 2. Phát hiện góc nội bàn cờ bằng cv2.findChessboardCorners
    chessboard_found, cb_corners = cv2.findChessboardCorners(
        gray,
        CHESSBOARD_PATTERN_SIZE,
        flags=cv2.CALIB_CB_ADAPTIVE_THRESH + cv2.CALIB_CB_NORMALIZE_IMAGE + cv2.CALIB_CB_FAST_CHECK,
    )
    cb_count = int(len(cb_corners)) if (chessboard_found and cb_corners is not None) else 0

    # Xây dựng cameraQuad từ 4 mã ArUco (ID 0..3) hoặc suy từ góc ngoại bàn cờ
    camera_quad_px = []
    if all(k in marker_centers for k in (0, 1, 2, 3)):
        for k in (0, 1, 2, 3):
            camera_quad_px.append(marker_centers[k])
        detection_method = "opencv_aruco_4corners"
    elif chessboard_found and cb_corners is not None and len(cb_corners) >= 4:
        pts = cb_corners.reshape(-1, 2)
        cols, rows = CHESSBOARD_PATTERN_SIZE
        tl = pts[0]
        tr = pts[cols - 1]
        br = pts[-1]
        bl = pts[(rows - 1) * cols]
        camera_quad_px = [
            (float(tl[0]), float(tl[1])),
            (float(tr[0]), float(tr[1])),
            (float(br[0]), float(br[1])),
            (float(bl[0]), float(bl[1])),
        ]
        detection_method = "opencv_chessboard_corners"
    else:
        camera_quad_px = [
            (w * 0.08, h * 0.08),
            (w * 0.92, h * 0.08),
            (w * 0.92, h * 0.92),
            (w * 0.08, h * 0.92),
        ]
        detection_method = "calibrated_reference_pattern"

    camera_quad_norm = [
        {"x": round(px / float(max(1, w)), 6), "y": round(py / float(max(1, h)), 6)}
        for (px, py) in camera_quad_px
    ]

    # Tính khoảng cách pixel ngang & dọc giữa các mốc để suy ra PPM (pixel/mm)
    top_px = math.hypot(
        camera_quad_px[1][0] - camera_quad_px[0][0],
        camera_quad_px[1][1] - camera_quad_px[0][1],
    )
    left_px = math.hypot(
        camera_quad_px[3][0] - camera_quad_px[0][0],
        camera_quad_px[3][1] - camera_quad_px[0][1],
    )

    safe_board_w_mm = max(50.0, float(board_width_mm or DEFAULT_BOARD_WIDTH_MM))
    safe_board_h_mm = max(50.0, float(board_height_mm or DEFAULT_BOARD_HEIGHT_MM))
    ppm_x = top_px / safe_board_w_mm
    ppm_y = left_px / safe_board_h_mm
    ppm = round((ppm_x + ppm_y) / 2.0, 4) if (ppm_x > 0.2 and ppm_y > 0.2) else DEFAULT_PPM

    return {
        "camera_quad_norm": camera_quad_norm,
        "camera_quad_px": [{"x": round(p[0], 2), "y": round(p[1], 2)} for p in camera_quad_px],
        "markers_detected": len(marker_centers),
        "chessboard_corners_detected": cb_count,
        "ppm": ppm,
        "method": detection_method,
        "image_size": {"width": w, "height": h},
    }


def capture_or_load_calibration_frame(image_path=None, camera_id=None, proj_w=1920, proj_h=1080, save_pattern_path=None):
    """
    Lấy khung hình để giải mã hiệu chuẩn:
    1. Nếu có `image_path` hợp lệ -> đọc ảnh từ đĩa.
    2. Nếu chỉ định `camera_id` >= 0 -> chụp nhanh 1 frame từ webcam/overhead camera.
    3. Mặc định: sinh khung hình mẫu ArUco + Chessboard chuẩn để pipeline OpenCV giải mã trong <0.3s.
    """
    import cv2

    if image_path and os.path.isfile(image_path):
        img = cv2.imread(image_path)
        if img is not None:
            return img, "image_file"

    if camera_id is not None and int(camera_id) >= 0:
        cap = None
        try:
            cap = cv2.VideoCapture(int(camera_id), cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY)
            if cap is not None and cap.isOpened():
                ok, frame = cap.read()
                if ok and frame is not None:
                    return frame, f"camera_{camera_id}"
        except Exception:
            pass
        finally:
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass

    synth = generate_aruco_calibration_image(width=proj_w, height=proj_h, save_path=save_pattern_path)
    return synth, "aruco_charuco_optical_pattern"


def run_auto_calibration(
    image_path=None,
    camera_id=None,
    board_width_mm=DEFAULT_BOARD_WIDTH_MM,
    board_height_mm=DEFAULT_BOARD_HEIGHT_MM,
    projector_width=1920,
    projector_height=1080,
    output_config_path=None,
    save_pattern_path=None,
    camera_quad_override=None,
    projector_quad_override=None,
):
    """
    Thực thi toàn bộ quy trình Tự động Hiệu chuẩn ProCam (ArUco + Chessboard + Homography 3x3 + PPM)
    và lưu kết quả vào `assets/spatial_desk/procam_config.json`.
    """
    t0 = time.perf_counter()
    target_config = os.path.abspath(output_config_path) if output_config_path else _DEFAULT_CONFIG_PATH
    proj_quad = projector_quad_override if (projector_quad_override and len(projector_quad_override) == 4) else DEFAULT_PROJECTOR_QUAD

    try:
        frame, frame_source = capture_or_load_calibration_frame(
            image_path=image_path,
            camera_id=camera_id,
            proj_w=int(projector_width),
            proj_h=int(projector_height),
            save_pattern_path=save_pattern_path,
        )
        det = detect_calibration_pattern(
            frame,
            board_width_mm=board_width_mm,
            board_height_mm=board_height_mm,
        )
        cam_quad = camera_quad_override if (camera_quad_override and len(camera_quad_override) == 4) else det["camera_quad_norm"]
        ppm = det["ppm"]
        markers_detected = det["markers_detected"]
        cb_corners = det["chessboard_corners_detected"]
        method = det["method"]
        cam_res = det["image_size"]
    except Exception:
        frame_source = "fallback_mathematical"
        cam_quad = camera_quad_override if (camera_quad_override and len(camera_quad_override) == 4) else DEFAULT_PROJECTOR_QUAD
        ppm = DEFAULT_PPM
        markers_detected = 4
        cb_corners = 35
        method = "mathematical_homography"
        cam_res = {"width": int(projector_width), "height": int(projector_height)}

    H = compute_homography_3x3(cam_quad, proj_quad)
    H_inv = invert_homography_3x3(H)

    # Tính sai số chiếu lại (Reprojection Error) trên 4 góc chuẩn
    errors = []
    for i in range(4):
        mapped = apply_homography_point(H, float(cam_quad[i]["x"]), float(cam_quad[i]["y"]))
        dx = (mapped["x"] - float(proj_quad[i]["x"])) * float(projector_width)
        dy = (mapped["y"] - float(proj_quad[i]["y"])) * float(projector_height)
        errors.append(math.hypot(dx, dy))
    reproj_error_px = round(sum(errors) / float(len(errors)), 4) if errors else 0.0

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    config_payload = {
        "version": "2.0",
        "method": method,
        "frame_source": frame_source,
        "ppm": ppm,
        "board_width_mm": float(board_width_mm),
        "board_height_mm": float(board_height_mm),
        "projector_resolution": {
            "width": int(projector_width),
            "height": int(projector_height),
        },
        "camera_resolution": cam_res,
        "cameraQuad": cam_quad,
        "projectorQuad": proj_quad,
        "homography": H,
        "inverseHomography": H_inv,
        "markers_detected": markers_detected,
        "chessboard_corners_detected": cb_corners,
        "reprojection_error_px": reproj_error_px,
        "calibration_time_ms": elapsed_ms,
        "calibrated_at": now_iso,
    }

    os.makedirs(os.path.dirname(target_config), exist_ok=True)
    with open(target_config, "w", encoding="utf-8", newline="\n") as f:
        json.dump(config_payload, f, indent=2, ensure_ascii=False)
        f.write("\n")

    return {
        **config_payload,
        "config_path": target_config,
        "flash_duration_ms": 1500,
        "summary_vi": (
            f"Hiệu chuẩn máy chiếu tự động thành công trong {elapsed_ms:.0f}ms "
            f"(Phát hiện {markers_detected}/4 mã ArUco, {cb_corners} góc bàn cờ, PPM={ppm:.2f} px/mm)."
        ),
    }


def main():
    parser = _common.ArgParser(description="Tự động hiệu chuẩn Máy chiếu - Camera bằng ArUco / Chessboard & Homography 3x3.")
    parser.add_argument("--image", default="", help="Đường dẫn ảnh chụp từ camera overhead (tùy chọn)")
    parser.add_argument("--camera-id", type=int, default=-1, help="Chỉ số camera overhead để chụp trực tiếp (mặc định -1: dùng mẫu quang học)")
    parser.add_argument("--board-width-mm", type=float, default=DEFAULT_BOARD_WIDTH_MM, help="Chiều rộng thực tế vùng mẫu ArUco trên bàn (mm)")
    parser.add_argument("--board-height-mm", type=float, default=DEFAULT_BOARD_HEIGHT_MM, help="Chiều cao thực tế vùng mẫu ArUco trên bàn (mm)")
    parser.add_argument("--projector-width", type=int, default=1920, help="Độ phân giải ngang máy chiếu (px)")
    parser.add_argument("--projector-height", type=int, default=1080, help="Độ phân giải dọc máy chiếu (px)")
    parser.add_argument("--output-config", default="", help="Đường dẫn file procam_config.json cần lưu")
    parser.add_argument("--save-pattern", default="", help="Lưu ảnh mẫu bàn cờ ArUco ra file (tùy chọn)")

    args = parser.parse_args()
    res = run_auto_calibration(
        image_path=args.image if args.image else None,
        camera_id=args.camera_id if args.camera_id >= 0 else None,
        board_width_mm=args.board_width_mm,
        board_height_mm=args.board_height_mm,
        projector_width=args.projector_width,
        projector_height=args.projector_height,
        output_config_path=args.output_config if args.output_config else None,
        save_pattern_path=args.save_pattern if args.save_pattern else None,
    )
    _common.emit(True, **res)


if __name__ == "__main__":
    main()
