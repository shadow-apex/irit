"""
tools/color_picker.py — lấy mã màu (RGB/HEX) của điểm ảnh tại toạ độ, hoặc tại vị trí chuột.

    python tools/color_picker.py [x y]

Dùng PIL.ImageGrab (all_screens) nên đọc được cả màn hình phụ (toạ độ âm).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402


def to_int(v):
    return int(round(float(v)))


def pick_color(x=None, y=None):
    _common.dpi_aware()
    if x is None or y is None:
        pg = _common.require("pyautogui")
        x, y = pg.position()
    from PIL import ImageGrab

    x, y = int(x), int(y)
    img = ImageGrab.grab(bbox=(x, y, x + 1, y + 1), all_screens=True).convert("RGB")
    r, g, b = img.getpixel((0, 0))
    return {"x": x, "y": y, "rgb": {"r": r, "g": g, "b": b}, "hex": "#{:02X}{:02X}{:02X}".format(r, g, b)}


def build_parser():
    p = _common.ArgParser(description="Lấy màu điểm ảnh trên màn hình")
    p.add_argument("x", type=to_int, nargs="?", default=None)
    p.add_argument("y", type=to_int, nargs="?", default=None)
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    try:
        _common.emit(True, **pick_color(a.x, a.y))
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không đọc được màu: {e}")
