"""
tools/ui_automation.py — Truy vấn và tương tác nhanh các phần tử giao diện Windows qua Win32/UIA.

    python tools/ui_automation.py dump [--target=active|title|exe]
    python tools/ui_automation.py find "OK" [--target=active]
    python tools/ui_automation.py click "Save" [--target=active]
    python tools/ui_automation.py set_text "Search" "my query" [--target=active]

Đọc cây điều khiển (Buttons, Edits, Checkboxes...) trực tiếp qua Windows API trong 5-20ms,
không cần nén ảnh màn hình hay chạy mô hình OCR/OmniParser.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_common.ensure_utf8()
from _winutil import foreground_window, select_windows, enum_windows  # noqa: E402


def get_target_window(target_query=None):
    """Tìm hwnd của cửa sổ mục tiêu (mặc định là cửa sổ active)."""
    target = (target_query or "active").strip().lower()
    if target in ("active", "current", "focused", "top", "this"):
        fg = foreground_window()
        if fg and fg.get("hwnd"):
            return fg
    # Tìm theo tên/title
    all_wins = enum_windows(visible_only=True)
    matched = select_windows(all_wins, target)
    return matched[0] if matched else None


def enumerate_controls(hwnd):
    """Liệt kê các control con của cửa sổ qua EnumChildWindows và GetWindowRect."""
    import ctypes
    from ctypes import wintypes

    u = ctypes.windll.user32
    proc_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    u.EnumChildWindows.argtypes = [wintypes.HWND, proc_t, wintypes.LPARAM]
    u.IsWindowVisible.argtypes = [wintypes.HWND]
    u.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    u.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    u.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    u.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]

    controls = []

    def cb(child_hwnd, _lparam):
        if not u.IsWindowVisible(child_hwnd):
            return True

        rect = wintypes.RECT()
        u.GetWindowRect(child_hwnd, ctypes.byref(rect))
        w = rect.right - rect.left
        h = rect.bottom - rect.top

        # Bỏ qua các control 0 kích thước hoặc ngoài màn hình
        if w <= 0 or h <= 0:
            return True

        # Đọc text
        n = u.GetWindowTextLengthW(child_hwnd)
        buf = ctypes.create_unicode_buffer(max(1, n + 1))
        if n > 0:
            u.GetWindowTextW(child_hwnd, buf, n + 1)
        text = buf.value.strip()

        # Đọc Class Name
        cls_buf = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(child_hwnd, cls_buf, 256)
        cls_name = cls_buf.value

        center_x = rect.left + w // 2
        center_y = rect.top + h // 2

        ctrl_type = "Element"
        lower_cls = cls_name.lower()
        if "button" in lower_cls:
            ctrl_type = "Button"
        elif "edit" in lower_cls:
            ctrl_type = "Edit"
        elif "combo" in lower_cls:
            ctrl_type = "ComboBox"
        elif "static" in lower_cls:
            ctrl_type = "Static"
        elif "list" in lower_cls:
            ctrl_type = "ListView"
        elif "tab" in lower_cls:
            ctrl_type = "Tab"

        controls.append({
            "hwnd": int(child_hwnd),
            "name": text,
            "class": cls_name,
            "type": ctrl_type,
            "rect": {"left": rect.left, "top": rect.top, "right": rect.right, "bottom": rect.bottom, "width": w, "height": h},
            "center": {"x": center_x, "y": center_y},
        })
        return True

    u.EnumChildWindows(wintypes.HWND(hwnd), proc_t(cb), 0)
    return controls


def find_control(controls, query):
    """Tìm control theo tên hoặc text khớp nhất."""
    q = (query or "").strip().lower()
    if not q:
        return None

    # Khớp chính xác tên
    for c in controls:
        if c["name"].lower() == q:
            return c

    # Khớp chuỗi con
    for c in controls:
        if q in c["name"].lower():
            return c

    # Khớp class type
    for c in controls:
        if q == c["type"].lower():
            return c

    return None


def click_control(ctrl):
    """Click vào control qua toạ độ tâm hoặc WM_COMMAND."""
    import ctypes
    from ctypes import wintypes
    import time

    hwnd = ctrl["hwnd"]
    cx, cy = ctrl["center"]["x"], ctrl["center"]["y"]

    u = ctypes.windll.user32
    # Thử gửi BM_CLICK (0x00F5) cho Button
    if ctrl["type"] == "Button":
        u.SendMessageW(wintypes.HWND(hwnd), 0x00F5, 0, 0)
        return {"action": "bm_click", "success": True, "x": cx, "y": cy}

    # Hoặc di chuột click vật lý tại toạ độ tâm
    u.SetCursorPos(cx, cy)
    time.sleep(0.02)
    # MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004
    u.mouse_event(0x0002, 0, 0, 0, 0)
    time.sleep(0.02)
    u.mouse_event(0x0004, 0, 0, 0, 0)

    return {"action": "mouse_click", "success": True, "x": cx, "y": cy}


def set_control_text(ctrl, text):
    """Điền text trực tiếp vào Edit control qua WM_SETTEXT (0x000C)."""
    import ctypes
    from ctypes import wintypes

    hwnd = ctrl["hwnd"]
    u = ctypes.windll.user32
    # WM_SETTEXT = 0x000C
    res = u.SendMessageW(wintypes.HWND(hwnd), 0x000C, 0, ctypes.c_wchar_p(text))
    return {"action": "set_text", "success": bool(res), "text": text}


def main():
    parser = argparse.ArgumentParser(description="Windows UI Automation qua Win32 API.")
    parser.add_argument("--target", default="active", help="Cửa sổ mục tiêu (active, title hoặc exe)")

    sub = parser.add_subparsers(dest="action", required=True)

    # dump
    sub.add_parser("dump", help="Liệt kê toàn bộ control của cửa sổ")

    # find
    f_p = sub.add_parser("find", help="Tìm kiếm control")
    f_p.add_argument("query", help="Tên hoặc nhãn cần tìm")

    # click
    c_p = sub.add_parser("click", help="Click vào control")
    c_p.add_argument("query", help="Tên hoặc nhãn nút cần click")

    # set_text
    s_p = sub.add_parser("set_text", help="Điền text vào ô nhập liệu")
    s_p.add_argument("query", help="Tên ô nhập liệu hoặc Edit")
    s_p.add_argument("text", help="Nội dung cần nhập")

    args = parser.parse_args()

    win = get_target_window(args.target)
    if not win:
        _common.fail(f"Không tìm thấy cửa sổ phù hợp với target '{args.target}'.")

    hwnd = win.get("hwnd")
    controls = enumerate_controls(hwnd)

    if args.action == "dump":
        _common.emit(True, window=win, count=len(controls), controls=controls)

    elif args.action == "find":
        ctrl = find_control(controls, args.query)
        if not ctrl:
            _common.fail(f"Không tìm thấy control nào khớp với '{args.query}'.", window=win, total_controls=len(controls))
        _common.emit(True, window=win, match=ctrl)

    elif args.action == "click":
        ctrl = find_control(controls, args.query)
        if not ctrl:
            _common.fail(f"Không tìm thấy nút/phần tử '{args.query}' để click.", window=win)
        res = click_control(ctrl)
        _common.emit(True, window=win, target=ctrl["name"] or ctrl["type"], **res)

    elif args.action == "set_text":
        ctrl = find_control(controls, args.query)
        if not ctrl:
            _common.fail(f"Không tìm thấy ô nhập liệu '{args.query}'.", window=win)
        res = set_control_text(ctrl, args.text)
        _common.emit(True, window=win, target=ctrl["name"] or ctrl["type"], **res)


if __name__ == "__main__":
    main()
