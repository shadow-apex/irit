"""
tools/color_picker.py

Lay ma mau (RGB/HEX) cua diem anh tai toa do chi dinh, hoac tai vi tri con
tro chuot hien tai neu khong truyen toa do. Dung pyautogui.pixel() (da di
kem san voi pyautogui, khong can cai them gi).

Vi du dung:
    python tools/color_picker.py               # mau tai vi tri chuot hien tai
    python tools/color_picker.py 400 300        # mau tai toa do (400, 300)
"""
import sys
import io
import json
import argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import pyautogui
except ImportError:
    print(json.dumps({"success": False, "error": "Thieu thu vien pyautogui. Chay: pip install -r tools/requirements.txt"}))
    sys.exit(1)


def pick_color(x=None, y=None):
    if x is None or y is None:
        x, y = pyautogui.position()
    try:
        r, g, b = pyautogui.pixel(int(x), int(y))
    except Exception as e:
        return {"success": False, "error": str(e)}
    return {
        "success": True,
        "x": int(x),
        "y": int(y),
        "rgb": {"r": r, "g": g, "b": b},
        "hex": "#{:02X}{:02X}{:02X}".format(r, g, b),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Lay ma mau diem anh tren man hinh")
    parser.add_argument("x", type=int, nargs="?", default=None)
    parser.add_argument("y", type=int, nargs="?", default=None)
    args = parser.parse_args()
    print(json.dumps(pick_color(args.x, args.y)))
