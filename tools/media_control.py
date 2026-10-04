"""tools/media_control.py — phím media toàn cục: playpause | next | prev (không tự cài thư viện)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

KEYS = {"playpause": ("playpause", "Đã bật/tắt phát nhạc."), "next": ("nexttrack", "Đã chuyển bài kế tiếp."),
        "prev": ("prevtrack", "Đã quay lại bài trước.")}


def build_parser():
    p = _common.ArgParser()
    p.add_argument("action", choices=sorted(KEYS))
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    pg = _common.require("pyautogui")
    pg.PAUSE = 0
    try:
        pg.press(KEYS[a.action][0])
    except Exception as e:  # noqa: BLE001
        _common.fail(str(e))
    _common.emit(True, message=KEYS[a.action][1])
