"""
tools/magic_move.py — di chuyển cửa sổ: cửa sổ đang focus (có đếm ngược thật) hoặc theo tên.

    python tools/magic_move.py --active --wait 5 -x 100 -y 100
    python tools/magic_move.py --name "Notepad" -x 100 -y 100
    IRIS_DEV_TOOLS=1 python tools/magic_move.py --demo --name "Notepad"      # chỉ để dev

TL-07: `--wait N` đếm ngược thật rồi mới lấy cửa sổ focus; cửa sổ của chính Iris bị từ chối.
Chế độ biểu diễn `--demo` chỉ chạy khi IRIS_DEV_TOOLS=1. Đã xoá `--setup`/`--demo2` (cứng theo
máy tác giả: antigravity/cursor, mở claude.ai bằng shell=True).
"""
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_WAIT = 30


def move_active_window(x, y, wait_time=0):
    import _winutil

    wait = max(0, min(int(wait_time), MAX_WAIT))
    for _ in range(wait):
        time.sleep(1)
    win = _winutil.foreground_window()
    if not win:
        return {"success": False, "error": "Không có cửa sổ nào đang được focus."}
    if _winutil.is_self_window(win):
        return {"success": False,
                "error": "Cửa sổ đang focus là chính Iris — hãy bấm vào cửa sổ muốn di chuyển rồi thử lại."}
    if not _winutil.move_resize(win["hwnd"], x, y):
        return {"success": False, "error": "Không di chuyển được cửa sổ (có thể cần quyền cao hơn)."}
    return {"success": True, "message": f"Đã di chuyển '{win['title']}' đến ({x}, {y}).", "window": win["title"]}


def move_window_by_name(title, x, y):
    import _winutil
    from move_window import validate_window_title

    t = validate_window_title(title)
    wins = _winutil.select_windows(_winutil.enum_windows(), t)
    if not wins:
        return {"success": False, "error": f"Không tìm thấy cửa sổ nào khớp '{t}'."}
    win = wins[0]
    if not _winutil.move_resize(win["hwnd"], x, y):
        return {"success": False, "error": "Không di chuyển được cửa sổ."}
    return {"success": True, "message": f"Đã di chuyển '{win['title']}' đến ({x}, {y}).", "window": win["title"]}


def demo_mode(name):
    """Biểu diễn zig-zag + sóng sin (CHỈ dev)."""
    import _winutil
    from move_window import validate_window_title

    t = validate_window_title(name)
    wins = _winutil.select_windows(_winutil.enum_windows(), t)
    if not wins:
        return {"success": False, "error": f"Không tìm thấy cửa sổ '{t}'."}
    hwnd = wins[0]["hwnd"]
    _winutil.move_resize(hwnd, 100, 100, 500, 400)
    for i in range(10):
        _winutil.move_resize(hwnd, 100 + i * 60, 100 if i % 2 == 0 else 300)
        time.sleep(0.04)
    for xx in range(100, 800, 15):
        _winutil.move_resize(hwnd, xx, int(300 + 150 * math.sin(xx / 40.0)))
        time.sleep(0.01)
    _winutil.move_resize(hwnd, 250, 150, 800, 600)
    return {"success": True, "message": "Xong màn biểu diễn."}


def build_parser():
    p = _common.ArgParser(description="Di chuyển cửa sổ Windows")
    p.add_argument("--active", action="store_true", help="cửa sổ đang focus (kết hợp --wait)")
    p.add_argument("--wait", type=int, default=0, help="giây đếm ngược trước khi lấy cửa sổ focus")
    p.add_argument("--demo", action="store_true", help="biểu diễn (cần IRIS_DEV_TOOLS=1)")
    p.add_argument("--name", type=str, default=None)
    p.add_argument("-x", type=int, default=0)
    p.add_argument("-y", type=int, default=0)
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    _common.dpi_aware()
    a = build_parser().parse_args()
    try:
        if a.demo:
            if os.environ.get("IRIS_DEV_TOOLS") != "1":
                _common.fail("Chế độ demo chỉ bật khi IRIS_DEV_TOOLS=1.")
            if not a.name:
                _common.fail("--demo cần --name.")
            res = demo_mode(a.name)
        elif a.name:
            res = move_window_by_name(a.name, a.x, a.y)
        else:
            res = move_active_window(a.x, a.y, a.wait)
    except ValueError as e:
        _common.fail(str(e))
    ok = res.pop("success")
    _common.emit(ok, **res)
