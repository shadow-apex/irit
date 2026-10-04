"""
tools/move_window.py — di chuyển / đổi kích thước một cửa sổ theo tiêu đề (hoặc tên exe).

    python tools/move_window.py "Notepad" 100 100 [--width W] [--height H]

TL-01: KHÔNG còn PowerShell/C# biên dịch lúc chạy và KHÔNG nội suy tiêu đề vào mã. Dùng thẳng
ctypes (EnumWindows/SetWindowPos). Tiêu đề chỉ là DỮ LIỆU so khớp chuỗi con.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_TITLE_LEN = 200


def validate_window_title(title):
    """Chuẩn hoá và kiểm tra tiêu đề; ném ValueError nếu rỗng/quá dài/có ký tự điều khiển."""
    if not isinstance(title, str):
        raise ValueError("Tiêu đề phải là chuỗi.")
    t = title.strip()
    if not t:
        raise ValueError("Tiêu đề cửa sổ rỗng.")
    if len(t) > MAX_TITLE_LEN:
        raise ValueError(f"Tiêu đề quá dài (> {MAX_TITLE_LEN} ký tự).")
    if any(ord(c) < 32 or ord(c) == 127 for c in t):
        raise ValueError("Tiêu đề chứa ký tự điều khiển.")
    return t


def move_window(title, x, y, width=None, height=None):
    import _winutil

    t = validate_window_title(title)
    wins = _winutil.select_windows(_winutil.enum_windows(), t)
    if not wins:
        return {"success": False, "error": f"Không tìm thấy cửa sổ nào khớp '{t}' (cửa sổ của chính Iris bị loại)."}
    win = wins[0]
    ok = _winutil.move_resize(win["hwnd"], x, y, width, height)
    if not ok:
        return {"success": False, "error": "SetWindowPos thất bại (cửa sổ có thể chạy với quyền cao hơn Iris)."}
    return {"success": True, "message": f"Đã di chuyển '{win['title']}' đến ({x}, {y}).",
            "matched": len(wins), "window": win["title"]}


def build_parser():
    p = _common.ArgParser(description="Di chuyển và đổi kích thước cửa sổ")
    p.add_argument("title")
    p.add_argument("x", type=int)
    p.add_argument("y", type=int)
    p.add_argument("--width", type=int, default=None)
    p.add_argument("--height", type=int, default=None)
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    _common.dpi_aware()
    a = build_parser().parse_args()
    try:
        res = move_window(a.title, a.x, a.y, a.width, a.height)
    except ValueError as e:
        _common.fail(str(e))
    ok = res.pop("success")
    _common.emit(ok, **res)
