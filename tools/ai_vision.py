import os
import time
import tempfile
import argparse
from datetime import datetime
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# QUAN TRONG: khai bao DPI-awareness truoc khi import pyautogui, neu khong
# tren man hinh Windows co scaling (125%/150%...) anh chup se bi thu nho
# theo ty le scaling thay vi kich thuoc pixel that -> toa do AI doc duoc tu
# anh se lech so voi toa do chuot that.
try:
    import ctypes
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE_V2
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()  # fallback cho Windows cu
    except Exception:
        pass

import pyautogui

MAX_KEEP_FILES = 20
MAX_AGE_SECONDS = 24 * 3600


def _cleanup_old(output_dir):
    """Dọn ảnh cũ: xoá file > 24h và giữ tối đa MAX_KEEP_FILES file mới nhất."""
    try:
        files = []
        for name in os.listdir(output_dir):
            if name.startswith("screenshot_") and name.lower().endswith((".jpg", ".png")):
                path = os.path.join(output_dir, name)
                files.append((os.path.getmtime(path), path))
        files.sort(reverse=True)
        now = time.time()
        for i, (mtime, path) in enumerate(files):
            if i >= MAX_KEEP_FILES or now - mtime > MAX_AGE_SECONDS:
                try:
                    os.remove(path)
                except OSError:
                    pass
    except OSError:
        pass


def take_screenshot(output_dir=None):
    """Chụp màn hình, thu nhỏ về <=1280px, lưu JPEG (quality 70) và in SCREENSHOT_PATH=<đường dẫn>."""
    if output_dir is None or output_dir == ".":
        # Node truyền --outdir = <userData>/screenshots. Nếu chạy tay: thư mục tạm của hệ điều hành
        # (KHÔNG ghi vào repo — tránh commit nhầm ảnh màn hình thật).
        output_dir = os.environ.get("IRIS_SCREENSHOT_DIR") or os.path.join(tempfile.gettempdir(), "iris-screenshots")

    os.makedirs(output_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filepath = os.path.abspath(os.path.join(output_dir, f"screenshot_{timestamp}.jpg"))

    print("Đang chụp ảnh màn hình...")
    screenshot = pyautogui.screenshot()
    # Ảnh gốc 4K ~ vài MB: thu nhỏ + JPEG để nhẹ cho Gemini Live (đủ đọc chữ).
    img = screenshot.convert("RGB")
    img.thumbnail((1280, 1280))
    img.save(filepath, "JPEG", quality=70, optimize=True)

    _cleanup_old(output_dir)

    print(f"Thành công! Ảnh màn hình đã được lưu tại: {filepath}")
    print(f"SCREENSHOT_PATH={filepath}")  # dòng cuối: Node parse bằng regex đơn giản
    return filepath

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Công cụ Con mắt AI (Chụp ảnh màn hình)")
    parser.add_argument("--outdir", type=str, help="Thư mục lưu ảnh", default=".")
    
    args = parser.parse_args()
    
    take_screenshot(args.outdir)
