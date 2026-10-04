"""tools/desktop_manager.py — màn hình ảo (Win+Ctrl+...): new | close | left | right | boss (không tự cài thư viện)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

HOTKEYS = {
    "new": (("win", "ctrl", "d"), "Đã tạo màn hình ảo mới."),
    "close": (("win", "ctrl", "f4"), "Đã đóng màn hình ảo hiện tại."),
    "left": (("win", "ctrl", "left"), "Đã chuyển sang màn hình ảo bên trái."),
    "right": (("win", "ctrl", "right"), "Đã chuyển sang màn hình ảo bên phải."),
    "boss": (("win", "d"), "Đã hiện màn hình nền (Boss Key)."),
}


def build_parser():
    p = _common.ArgParser()
    p.add_argument("action", choices=sorted(HOTKEYS))
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    pg = _common.require("pyautogui")
    pg.PAUSE = 0
    try:
        pg.hotkey(*HOTKEYS[a.action][0])
    except Exception as e:  # noqa: BLE001
        _common.fail(str(e))
    _common.emit(True, message=HOTKEYS[a.action][1])
