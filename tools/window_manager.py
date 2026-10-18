"""
tools/window_manager.py — Điều khiển & sắp xếp mọi cửa sổ đang mở trên Windows.

    python tools/window_manager.py list
    python tools/window_manager.py focus <target>
    python tools/window_manager.py maximize [target]
    python tools/window_manager.py snap <position> [target]
    python tools/window_manager.py topmost <on|off> [target]

Positions cho snap:
- left, right, top, bottom
- top-left, top-right, bottom-left, bottom-right
- center, fullscreen
"""
import ctypes
from ctypes import wintypes
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402
import _winutil  # noqa: E402

SW_MAXIMIZE = 3
SW_RESTORE = 9
HWND_TOPMOST = -1
HWND_NOTOPMOST = -2
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_SHOWWINDOW = 0x0040


def get_work_area():
    """Lấy vùng làm việc của màn hình chính (trừ thanh Taskbar) bằng SystemParametersInfoW."""
    SPI_GETWORKAREA = 0x0030
    rect = wintypes.RECT()
    ok = ctypes.windll.user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0)
    if not ok:
        w = ctypes.windll.user32.GetSystemMetrics(0)
        h = ctypes.windll.user32.GetSystemMetrics(1)
        return (0, 0, w, h)
    return (rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)


def resolve_target_window(target):
    """Chọn cửa sổ mục tiêu: nếu 'active' hoặc rỗng -> cửa sổ đang focus (nếu là Iris thì lấy cửa sổ kế tiếp)."""
    t = (target or "active").strip()
    all_wins = [w for w in _winutil.enum_windows(visible_only=True) if not _winutil.is_self_window(w)]
    if not t or t.lower() == "active":
        fg = _winutil.foreground_window()
        if fg and not _winutil.is_self_window(fg):
            return fg
        if all_wins:
            return all_wins[0]
        _common.fail("Không tìm thấy cửa sổ nào đang mở trên màn hình.")

    matched = _winutil.select_windows(all_wins, t)
    if not matched:
        # Thử khớp ngắn hơn (< 4 ký tự) nếu người dùng gọi tên ngắn
        low = t.lower()
        matched = [
            w for w in all_wins if low in w.get("title", "").lower() or low in w.get("exe", "").lower()
        ]
    if not matched:
        _common.fail(f"Không tìm thấy cửa sổ nào khớp với '{t}'.")
    return matched[0]


def list_windows():
    wins = [w for w in _winutil.enum_windows(visible_only=True) if not _winutil.is_self_window(w)]
    fg = _winutil.foreground_window()
    fg_hwnd = fg["hwnd"] if fg else None
    items = []
    for w in wins:
        rect = _winutil.get_rect(w["hwnd"])
        items.append(
            {
                "hwnd": w["hwnd"],
                "pid": w["pid"],
                "exe": w["exe"],
                "title": w["title"],
                "focused": w["hwnd"] == fg_hwnd,
                "bounds": {"x": rect[0], "y": rect[1], "width": rect[2], "height": rect[3]} if rect else None,
            }
        )
    return {"action": "list", "count": len(items), "windows": items, "message": f"Đang có {len(items)} cửa sổ hiển thị."}


def focus_window(target):
    w = resolve_target_window(target)
    hwnd = w["hwnd"]
    u = ctypes.windll.user32
    if u.IsIconic(wintypes.HWND(hwnd)):
        _winutil.show_window(hwnd, SW_RESTORE)
    # Trick để vượt giới hạn SetForegroundWindow của Windows: attach thread input tạm thời
    try:
        fg_hwnd = u.GetForegroundWindow()
        fg_tid = u.GetWindowThreadProcessId(wintypes.HWND(fg_hwnd), None)
        cur_tid = ctypes.windll.kernel32.GetCurrentThreadId()
        if fg_tid and cur_tid and fg_tid != cur_tid:
            u.AttachThreadInput(cur_tid, fg_tid, True)
            u.BringWindowToTop(wintypes.HWND(hwnd))
            u.SetForegroundWindow(wintypes.HWND(hwnd))
            u.AttachThreadInput(cur_tid, fg_tid, False)
        else:
            _winutil.foreground(hwnd)
    except Exception:
        _winutil.foreground(hwnd)
    return {"action": "focus", "window": w, "message": f"Đã chuyển tiêu điểm sang '{w['title']}' ({w['exe']})."}


def maximize_window(target="active"):
    w = resolve_target_window(target)
    _winutil.show_window(w["hwnd"], SW_MAXIMIZE)
    _winutil.foreground(w["hwnd"])
    return {"action": "maximize", "window": w, "message": f"Đã phóng to tối đa cửa sổ '{w['title']}'."}


def snap_window(position, target="active"):
    w = resolve_target_window(target)
    hwnd = w["hwnd"]
    pos = (position or "left").strip().lower().replace("_", "-")

    if pos in ("maximize", "fullscreen", "full"):
        return maximize_window(target)

    # Khôi phục khỏi trạng thái Maximized trước khi đặt toạ độ mới
    _winutil.show_window(hwnd, SW_RESTORE)
    wx, wy, ww, wh = get_work_area()
    half_w = ww // 2
    half_h = wh // 2

    coords = {
        "left": (wx, wy, half_w, wh),
        "right": (wx + half_w, wy, ww - half_w, wh),
        "top": (wx, wy, ww, half_h),
        "bottom": (wx, wy + half_h, ww, wh - half_h),
        "top-left": (wx, wy, half_w, half_h),
        "top-right": (wx + half_w, wy, ww - half_w, half_h),
        "bottom-left": (wx, wy + half_h, half_w, wh - half_h),
        "bottom-right": (wx + half_w, wy + half_h, ww - half_w, wh - half_h),
        "center": (wx + ww // 6, wy + wh // 6, (ww * 2) // 3, (wh * 2) // 3),
    }
    if pos not in coords:
        _common.fail(
            f"Vị trí snap '{position}' không hợp lệ. Hỗ trợ: {', '.join(coords.keys())}, maximize."
        )

    x, y, width, height = coords[pos]
    _winutil.move_resize(hwnd, x, y, width, height)
    _winutil.foreground(hwnd)
    return {
        "action": "snap",
        "position": pos,
        "window": w,
        "bounds": {"x": x, "y": y, "width": width, "height": height},
        "message": f"Đã căn chỉnh cửa sổ '{w['title']}' sang vị trí {pos}.",
    }


def set_topmost(state, target="active"):
    w = resolve_target_window(target)
    hwnd = w["hwnd"]
    on = str(state or "on").strip().lower() in ("on", "true", "1", "yes")
    insert_after = HWND_TOPMOST if on else HWND_NOTOPMOST
    ctypes.windll.user32.SetWindowPos(
        wintypes.HWND(hwnd),
        wintypes.HWND(insert_after),
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
    )
    return {
        "action": "topmost",
        "always_on_top": on,
        "window": w,
        "message": f"Đã {'ghim' if on else 'bỏ ghim'} cửa sổ '{w['title']}' luôn nổi trên cùng.",
    }


def build_parser():
    p = _common.ArgParser(description="Quản lý cửa sổ nâng cao trên Windows.")
    p.add_argument("action", choices=["list", "focus", "maximize", "snap", "topmost"])
    p.add_argument("--target", default="active", help="Tên app/exe hoặc tiêu đề cửa sổ, hoặc 'active'.")
    p.add_argument("--position", default="left", help="Vị trí cho action=snap (left, right, top, bottom, center, ...).")
    p.add_argument("--state", default="on", help="on/off cho action=topmost.")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    _common.dpi_aware()
    args = build_parser().parse_args()
    if args.action == "list":
        res = list_windows()
    elif args.action == "focus":
        res = focus_window(args.target)
    elif args.action == "maximize":
        res = maximize_window(args.target)
    elif args.action == "snap":
        res = snap_window(args.position, args.target)
    elif args.action == "topmost":
        res = set_topmost(args.state, args.target)
    else:
        _common.fail(f"Action không hợp lệ: {args.action}")
    _common.emit(True, **res)
