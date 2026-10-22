"""tools/ui_automation.py — Windows UI Automation siêu tốc qua Windows UIA COM (UIAutomationCore.dll) & Win32.

Hỗ trợ các action:
    dump_tree / dump : Lấy danh sách các control kèm toạ độ và tên nút trong 5-10ms.
    click_name / click: Click thẳng vào phần tử theo nhãn/tên (qua UIA InvokePattern hoặc toạ độ).
    set_value / set_text: Điền text trực tiếp vào trường nhập liệu (qua UIA ValuePattern).
    find             : Tìm control phù hợp với nhãn/loại control.

Chạy trực tiếp qua Windows Accessibility / UIAutomationCore.dll trong tiến trình,
không phụ thuộc mô hình OCR hay OmniParser, tối ưu hóa CPU & RAM.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402
from _winutil import foreground_window, select_windows, enum_windows  # noqa: E402

# Mapping mã ControlType sang tên hiển thị chuẩn
UIA_CONTROL_TYPES = {
    50000: "Button",
    50001: "Calendar",
    50002: "CheckBox",
    50003: "ComboBox",
    50004: "Edit",
    50005: "Hyperlink",
    50006: "Image",
    50007: "ListItem",
    50008: "List",
    50009: "Menu",
    50010: "MenuBar",
    50011: "MenuItem",
    50012: "ProgressBar",
    50013: "RadioButton",
    50014: "ScrollBar",
    50015: "Slider",
    50016: "Spinner",
    50017: "StatusBar",
    50018: "Tab",
    50019: "TabItem",
    50020: "Text",
    50021: "ToolBar",
    50022: "ToolTip",
    50023: "Tree",
    50024: "TreeItem",
    50025: "Custom",
    50026: "Group",
    50027: "Thumb",
    50028: "DataGrid",
    50029: "DataItem",
    50030: "Document",
    50031: "SplitButton",
    50032: "Window",
    50033: "Pane",
    50034: "Header",
    50035: "HeaderItem",
    50036: "Table",
    50037: "TitleBar",
    50038: "Separator",
    50039: "SemanticZoom",
    50040: "AppBar",
}

# Pattern IDs trong UI Automation
UIA_INVOKE_PATTERN_ID = 10000
UIA_VALUE_PATTERN_ID = 10002
UIA_TOGGLE_PATTERN_ID = 10015


def attach_input_desktop():
    """Gắn thread hiện tại vào User Input Desktop để background worker truy cập được UIA."""
    if not _common.is_windows():
        return
    try:
        import ctypes

        user32 = ctypes.windll.user32
        h_input = user32.OpenInputDesktop(0, False, 0x0100)
        if h_input:
            user32.SetThreadDesktop(h_input)
    except Exception:
        pass


def _init_uia():
    """Khởi tạo COM và COM Object UIAutomation."""
    import ctypes
    from ctypes import wintypes

    ole32 = ctypes.windll.ole32
    ole32.CoInitializeEx(None, 0)  # COINIT_MULTITHREADED

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", wintypes.DWORD),
            ("Data2", wintypes.WORD),
            ("Data3", wintypes.WORD),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    ole32.CLSIDFromString.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(GUID)]
    ole32.IIDFromString.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(GUID)]
    ole32.CoCreateInstance.argtypes = [
        ctypes.POINTER(GUID),
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(GUID),
        ctypes.POINTER(ctypes.c_void_p),
    ]

    clsid = GUID()
    iid = GUID()
    ole32.CLSIDFromString("{ff48dba4-60ef-4201-aa87-54103eef594e}", ctypes.byref(clsid))
    ole32.IIDFromString("{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}", ctypes.byref(iid))

    p_uia = ctypes.c_void_p()
    hr = ole32.CoCreateInstance(ctypes.byref(clsid), None, 1, ctypes.byref(iid), ctypes.byref(p_uia))
    if hr != 0 or not p_uia.value:
        raise RuntimeError(f"Không thể tạo IUIAutomation COM (HRESULT={hex(hr)})")
    return p_uia


def get_target_window(target_query=None, hwnd=None, pid=None):
    """Xác định cửa sổ mục tiêu theo hwnd, pid hoặc target query (title/exe/'active')."""
    if hwnd:
        try:
            h = int(hwnd)
            for w in enum_windows(visible_only=False):
                if w.get("hwnd") == h:
                    return w
            return {"hwnd": h, "title": f"HWND({h})", "exe": "unknown", "pid": 0}
        except Exception:
            pass

    if pid:
        try:
            p = int(pid)
            for w in enum_windows(visible_only=True):
                if w.get("pid") == p:
                    return w
        except Exception:
            pass

    target = (target_query or "active").strip().lower()
    if target in ("active", "current", "focused", "top", "this", "cửa sổ này", "cua so nay"):
        fg = foreground_window()
        if fg and fg.get("hwnd"):
            return fg

    all_wins = enum_windows(visible_only=True)
    matched = select_windows(all_wins, target)
    return matched[0] if matched else None


def enumerate_uia_controls(hwnd, include_offscreen=False):
    """Quét các UI elements của cửa sổ qua Windows UIAutomationCore trong 5-15ms."""
    import ctypes
    from ctypes import wintypes

    attach_input_desktop()
    p_uia = _init_uia()
    uia_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(p_uia.value)

    # ElementFromHandle = vtable index 6
    ElementFromHandle = ctypes.WINFUNCTYPE(
        ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)
    )(uia_vtbl[6])

    # CreateTrueCondition = vtable index 21
    CreateTrueCondition = ctypes.WINFUNCTYPE(
        ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)
    )(uia_vtbl[21])

    p_elem = ctypes.c_void_p()
    hr = ElementFromHandle(p_uia, ctypes.c_void_p(hwnd), ctypes.byref(p_elem))
    if hr != 0 or not p_elem.value:
        return []

    p_cond = ctypes.c_void_p()
    CreateTrueCondition(p_uia, ctypes.byref(p_cond))

    elem_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(p_elem.value)
    # FindAll = vtable index 6 (TreeScope_Descendants = 4)
    FindAll = ctypes.WINFUNCTYPE(
        ctypes.c_long, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)
    )(elem_vtbl[6])

    p_array = ctypes.c_void_p()
    hr = FindAll(p_elem, 4, p_cond, ctypes.byref(p_array))
    if hr != 0 or not p_array.value:
        return []

    arr_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(p_array.value)
    GetLength = ctypes.WINFUNCTYPE(
        ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)
    )(arr_vtbl[3])
    GetElement = ctypes.WINFUNCTYPE(
        ctypes.c_long, ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)
    )(arr_vtbl[4])

    count = ctypes.c_int()
    GetLength(p_array, ctypes.byref(count))

    class RECT(ctypes.Structure):
        _fields_ = [
            ("left", wintypes.LONG),
            ("top", wintypes.LONG),
            ("right", wintypes.LONG),
            ("bottom", wintypes.LONG),
        ]

    controls = []
    total = count.value

    for i in range(total):
        p_sub = ctypes.c_void_p()
        GetElement(p_array, i, ctypes.byref(p_sub))
        if not p_sub.value:
            continue

        sub_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(p_sub.value)

        # Function pointers
        GetName = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_wchar_p))(sub_vtbl[23])
        GetControlType = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int))(sub_vtbl[21])
        GetRect = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(RECT))(sub_vtbl[43])
        GetIsEnabled = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL))(sub_vtbl[28])
        GetIsOffscreen = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL))(sub_vtbl[38])
        GetAutoId = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_wchar_p))(sub_vtbl[29])
        GetClassName = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_wchar_p))(sub_vtbl[30])

        bstr_name = ctypes.c_wchar_p()
        ct_id = ctypes.c_int(0)
        rc = RECT()
        is_enabled = wintypes.BOOL(True)
        is_offscreen = wintypes.BOOL(False)
        bstr_id = ctypes.c_wchar_p()
        bstr_class = ctypes.c_wchar_p()

        GetName(p_sub, ctypes.byref(bstr_name))
        GetControlType(p_sub, ctypes.byref(ct_id))
        GetRect(p_sub, ctypes.byref(rc))
        GetIsEnabled(p_sub, ctypes.byref(is_enabled))
        GetIsOffscreen(p_sub, ctypes.byref(is_offscreen))
        GetAutoId(p_sub, ctypes.byref(bstr_id))
        GetClassName(p_sub, ctypes.byref(bstr_class))

        name = (bstr_name.value or "").strip()
        ctrl_type = UIA_CONTROL_TYPES.get(ct_id.value, "Element")
        class_name = bstr_class.value or ""
        auto_id = bstr_id.value or ""

        w = rc.right - rc.left
        h = rc.bottom - rc.top

        # Bỏ qua các control rỗng hoặc offscreen nếu không bật include_offscreen
        if not include_offscreen:
            if is_offscreen.value:
                continue
            if w <= 0 or h <= 0:
                continue

        cx = rc.left + w // 2
        cy = rc.top + h // 2

        controls.append({
            "name": name,
            "type": ctrl_type,
            "control_type_id": ct_id.value,
            "class": class_name,
            "automation_id": auto_id,
            "is_enabled": bool(is_enabled.value),
            "is_offscreen": bool(is_offscreen.value),
            "rect": {
                "left": rc.left,
                "top": rc.top,
                "right": rc.right,
                "bottom": rc.bottom,
                "width": w,
                "height": h,
            },
            "center": {"x": cx, "y": cy},
            "_raw_ptr": p_sub.value,  # Sử dụng trong phiên tương tác nếu cần
        })

    return controls


def enumerate_win32_controls(hwnd):
    """Fallback liệt kê control qua EnumChildWindows cho các ứng dụng Win32 thuần cổ điển."""
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
        if w <= 0 or h <= 0:
            return True

        n = u.GetWindowTextLengthW(child_hwnd)
        buf = ctypes.create_unicode_buffer(max(1, n + 1))
        if n > 0:
            u.GetWindowTextW(child_hwnd, buf, n + 1)
        text = buf.value.strip()

        cls_buf = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(child_hwnd, cls_buf, 256)
        cls_name = cls_buf.value

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
            "type": ctrl_type,
            "class": cls_name,
            "rect": {
                "left": rect.left,
                "top": rect.top,
                "right": rect.right,
                "bottom": rect.bottom,
                "width": w,
                "height": h,
            },
            "center": {"x": rect.left + w // 2, "y": rect.top + h // 2},
            "is_enabled": True,
            "is_offscreen": False,
        })
        return True

    u.EnumChildWindows(wintypes.HWND(hwnd), proc_t(cb), 0)
    return controls


def enumerate_controls(hwnd, include_offscreen=False):
    """Tổng hợp: Quét qua UIA API trước (siêu tốc, hỗ trợ WPF/UWP/Electron); fallback sang Win32 nếu rỗng."""
    controls = []
    try:
        controls = enumerate_uia_controls(hwnd, include_offscreen=include_offscreen)
    except Exception:
        controls = []

    if not controls:
        try:
            controls = enumerate_win32_controls(hwnd)
        except Exception:
            controls = []

    return controls


def find_control(controls, query):
    """Tìm control khớp nhất theo query: Tên chính xác -> Chuỗi con -> Loại Type/Class -> AutomationId.

    Hàm thuần — được kiểm thử độc lập bởi tools/tests/test_ui_automation.py.
    """
    q = (query or "").strip().lower()
    if not q:
        return None

    # 1. Khớp chính xác tên (case-insensitive)
    for c in controls:
        if c.get("name", "").strip().lower() == q:
            return c

    # 2. Khớp chuỗi con trong tên
    for c in controls:
        name_lower = c.get("name", "").strip().lower()
        if name_lower and q in name_lower:
            return c

    # 3. Khớp Type/Class
    for c in controls:
        c_type = str(c.get("type", "")).strip().lower()
        c_cls = str(c.get("class", "")).strip().lower()
        if q == c_type or (c_cls and q == c_cls):
            return c

    # 4. Khớp AutomationId
    for c in controls:
        aid = str(c.get("automation_id", "")).strip().lower()
        if aid and q == aid:
            return c

    return None


def click_control(ctrl, window=None):
    """Click vào control: Thử UIA InvokePattern / TogglePattern trước, fallback sang toạ độ chuột vật lý."""
    import ctypes
    from ctypes import wintypes

    # Focus cửa sổ trước để click chính xác
    if window and window.get("hwnd"):
        try:
            ctypes.windll.user32.SetForegroundWindow(wintypes.HWND(window["hwnd"]))
            time.sleep(0.03)
        except Exception:
            pass

    # Thử InvokePattern / TogglePattern qua UIA nếu có con trỏ COM _raw_ptr
    ptr = ctrl.get("_raw_ptr")
    if ptr:
        try:
            sub_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(ptr)
            GetCurrentPattern = ctypes.WINFUNCTYPE(
                ctypes.c_long, ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)
            )(sub_vtbl[16])

            # Thử UIA_INVOKE_PATTERN_ID
            p_invoke = ctypes.c_void_p()
            hr = GetCurrentPattern(ptr, UIA_INVOKE_PATTERN_ID, ctypes.byref(p_invoke))
            if hr == 0 and p_invoke.value:
                inv_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(p_invoke.value)
                Invoke = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p)(inv_vtbl[3])
                hr_inv = Invoke(p_invoke)
                if hr_inv == 0:
                    return {
                        "action": "click",
                        "success": True,
                        "method": "uia_invoke",
                        "target": ctrl.get("name") or ctrl.get("type"),
                        "rect": ctrl.get("rect"),
                        "center": ctrl.get("center"),
                    }

            # Thử UIA_TOGGLE_PATTERN_ID (cho CheckBox, RadioButton, ToggleSwitch)
            p_toggle = ctypes.c_void_p()
            hr_tog = GetCurrentPattern(ptr, UIA_TOGGLE_PATTERN_ID, ctypes.byref(p_toggle))
            if hr_tog == 0 and p_toggle.value:
                tog_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(p_toggle.value)
                Toggle = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p)(tog_vtbl[3])
                if Toggle(p_toggle) == 0:
                    return {
                        "action": "click",
                        "success": True,
                        "method": "uia_toggle",
                        "target": ctrl.get("name") or ctrl.get("type"),
                        "rect": ctrl.get("rect"),
                        "center": ctrl.get("center"),
                    }
        except Exception:
            pass

    # Fallback BM_CLICK nếu là HWND Win32 thuần
    child_hwnd = ctrl.get("hwnd")
    if child_hwnd and ctrl.get("type") == "Button":
        try:
            ctypes.windll.user32.SendMessageW(wintypes.HWND(child_hwnd), 0x00F5, 0, 0)
            return {
                "action": "click",
                "success": True,
                "method": "win32_bm_click",
                "target": ctrl.get("name") or ctrl.get("type"),
                "rect": ctrl.get("rect"),
                "center": ctrl.get("center"),
            }
        except Exception:
            pass

    # Fallback toạ độ chuột vật lý
    center = ctrl.get("center") or {}
    cx, cy = center.get("x", 0), center.get("y", 0)
    if cx > 0 and cy > 0:
        u = ctypes.windll.user32
        u.SetCursorPos(cx, cy)
        time.sleep(0.02)
        u.mouse_event(0x0002, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTDOWN
        time.sleep(0.02)
        u.mouse_event(0x0004, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTUP
        return {
            "action": "click",
            "success": True,
            "method": "mouse_click",
            "target": ctrl.get("name") or ctrl.get("type"),
            "rect": ctrl.get("rect"),
            "center": {"x": cx, "y": cy},
        }

    return {"action": "click", "success": False, "error": "Không thể click vào phần tử mục tiêu."}


def set_control_text(ctrl, text, window=None):
    """Điền text trực tiếp vào control: Thử UIA ValuePattern trước, fallback sang Win32 WM_SETTEXT hoặc click+focus."""
    import ctypes
    from ctypes import wintypes

    # 1. Thử UIA ValuePattern (chớp nhoáng, không làm mất clipboard hay di chuột)
    ptr = ctrl.get("_raw_ptr")
    if ptr:
        try:
            sub_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(ptr)
            GetCurrentPattern = ctypes.WINFUNCTYPE(
                ctypes.c_long, ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)
            )(sub_vtbl[16])

            p_val = ctypes.c_void_p()
            hr = GetCurrentPattern(ptr, UIA_VALUE_PATTERN_ID, ctypes.byref(p_val))
            if hr == 0 and p_val.value:
                oleaut32 = ctypes.windll.oleaut32
                oleaut32.SysAllocString.restype = ctypes.c_void_p
                oleaut32.SysAllocString.argtypes = [ctypes.c_wchar_p]
                oleaut32.SysFreeString.argtypes = [ctypes.c_void_p]

                bstr_text = oleaut32.SysAllocString(str(text))
                val_vtbl = ctypes.POINTER(ctypes.c_void_p).from_address(p_val.value)
                SetValue = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p)(val_vtbl[3])
                hr_set = SetValue(p_val, bstr_text)
                oleaut32.SysFreeString(bstr_text)

                if hr_set == 0:
                    return {
                        "action": "set_value",
                        "success": True,
                        "method": "uia_value_pattern",
                        "target": ctrl.get("name") or ctrl.get("type"),
                        "text": text,
                    }
        except Exception:
            pass

    # 2. Fallback WM_SETTEXT nếu có HWND Edit
    child_hwnd = ctrl.get("hwnd")
    if child_hwnd:
        try:
            u = ctypes.windll.user32
            res = u.SendMessageW(wintypes.HWND(child_hwnd), 0x000C, 0, ctypes.c_wchar_p(text))
            if res:
                return {
                    "action": "set_value",
                    "success": True,
                    "method": "win32_wm_settext",
                    "target": ctrl.get("name") or ctrl.get("type"),
                    "text": text,
                }
        except Exception:
            pass

    # 3. Fallback Click + SetFocus nếu không áp dụng được ValuePattern
    try:
        click_control(ctrl, window=window)
        time.sleep(0.05)
        # Sử dụng SendInput hoặc paste nếu cần
        return {
            "action": "set_value",
            "success": True,
            "method": "focus_fallback",
            "target": ctrl.get("name") or ctrl.get("type"),
            "text": text,
            "note": "Đã click focus vào ô nhập liệu.",
        }
    except Exception as e:
        return {"action": "set_value", "success": False, "error": str(e)}


def main():
    _common.ensure_utf8()
    _common.dpi_aware()

    # Common parser cho các tuỳ chọn toàn cục (cho phép đặt trước hoặc sau subcommand)
    common_p = argparse.ArgumentParser(add_help=False)
    common_p.add_argument("--target", default=None, help="Cửa sổ mục tiêu (active, title hoặc exe)")
    common_p.add_argument("--hwnd", type=int, default=None, help="HWND trực tiếp của cửa sổ")
    common_p.add_argument("--pid", type=int, default=None, help="PID trực tiếp của tiến trình")
    common_p.add_argument("--include-offscreen", action="store_true", help="Bao gồm cả các phần tử ngoài màn hình")

    parser = argparse.ArgumentParser(
        parents=[common_p],
        description="Windows UI Automation siêu tốc qua UIAutomationCore COM."
    )

    sub = parser.add_subparsers(dest="action", required=True)

    # 1. dump_tree (aliases: dump)
    p_dump_tree = sub.add_parser("dump_tree", parents=[common_p], help="Liệt kê toàn bộ các control của cửa sổ")
    p_dump = sub.add_parser("dump", parents=[common_p], help="Liệt kê toàn bộ các control của cửa sổ")
    for p in (p_dump_tree, p_dump):
        p.add_argument("query", nargs="?", default="", help="Bộ lọc tên hoặc loại control (tuỳ chọn)")

    # 2. click_name (aliases: click)
    p_click_name = sub.add_parser("click_name", parents=[common_p], help="Click trực tiếp vào control theo tên/nhãn")
    p_click = sub.add_parser("click", parents=[common_p], help="Click trực tiếp vào control theo tên/nhãn")
    for p in (p_click_name, p_click):
        p.add_argument("query", help="Tên hoặc nhãn phần tử cần click")

    # 3. set_value (aliases: set_text)
    p_set_value = sub.add_parser("set_value", parents=[common_p], help="Điền text trực tiếp vào trường nhập liệu")
    p_set_text = sub.add_parser("set_text", parents=[common_p], help="Điền text trực tiếp vào trường nhập liệu")
    for p in (p_set_value, p_set_text):
        p.add_argument("query", help="Tên ô nhập liệu hoặc Edit")
        p.add_argument("text", help="Nội dung text cần điền")

    # 4. find (tra cứu control)
    p_find = sub.add_parser("find", parents=[common_p], help="Tìm kiếm control phù hợp")
    p_find.add_argument("query", help="Tên hoặc nhãn cần tìm")

    args = parser.parse_args()

    action = args.action.lower()
    t_start = time.perf_counter()

    win = get_target_window(target_query=args.target, hwnd=args.hwnd, pid=args.pid)
    if not win:
        _common.fail(f"Không tìm thấy cửa sổ phù hợp với target '{args.target}'.")

    hwnd = win.get("hwnd")
    controls = enumerate_controls(hwnd, include_offscreen=args.include_offscreen)
    elapsed_ms = round((time.perf_counter() - t_start) * 1000, 2)

    # Bỏ trường nội bộ _raw_ptr trước khi xuất JSON
    def clean_controls(ctrls):
        out = []
        for c in ctrls:
            item = dict(c)
            item.pop("_raw_ptr", None)
            out.append(item)
        return out

    # Xử lý dump_tree / dump
    if action in ("dump_tree", "dump"):
        filtered = controls
        filter_query = (getattr(args, "query", "") or "").strip().lower()
        if filter_query:
            filtered = [
                c for c in controls
                if filter_query in c.get("name", "").lower()
                or filter_query in c.get("type", "").lower()
                or filter_query in c.get("class", "").lower()
            ]
        _common.emit(
            True,
            action="dump_tree",
            window=win,
            count=len(filtered),
            controls=clean_controls(filtered),
            time_ms=elapsed_ms,
        )

    # Xử lý find
    elif action == "find":
        ctrl = find_control(controls, args.query)
        if not ctrl:
            _common.fail(
                f"Không tìm thấy control nào khớp với '{args.query}'.",
                window=win,
                total_controls=len(controls),
                time_ms=elapsed_ms,
            )
        matched = dict(ctrl)
        matched.pop("_raw_ptr", None)
        _common.emit(True, action="find", window=win, match=matched, time_ms=elapsed_ms)

    # Xử lý click_name / click
    elif action in ("click_name", "click"):
        ctrl = find_control(controls, args.query)
        if not ctrl:
            _common.fail(
                f"Không tìm thấy nút/phần tử '{args.query}' để click.",
                window=win,
                total_controls=len(controls),
                time_ms=elapsed_ms,
            )
        res = click_control(ctrl, window=win)
        res_elapsed_ms = round((time.perf_counter() - t_start) * 1000, 2)
        if not res.get("success"):
            _common.fail(res.get("error", "Lỗi khi click"), window=win, target=ctrl.get("name"), time_ms=res_elapsed_ms)
        is_ok = bool(res.pop("success", True))
        _common.emit(is_ok, window=win, time_ms=res_elapsed_ms, **res)

    # Xử lý set_value / set_text
    elif action in ("set_value", "set_text"):
        ctrl = find_control(controls, args.query)
        if not ctrl:
            # Fallback nếu query là rỗng hoặc "edit": tìm Edit/Document đầu tiên
            for c in controls:
                if c.get("type") in ("Edit", "Document", "ComboBox"):
                    ctrl = c
                    break
        if not ctrl:
            _common.fail(
                f"Không tìm thấy ô nhập liệu '{args.query}'.",
                window=win,
                total_controls=len(controls),
                time_ms=elapsed_ms,
            )
        res = set_control_text(ctrl, args.text, window=win)
        res_elapsed_ms = round((time.perf_counter() - t_start) * 1000, 2)
        if not res.get("success"):
            _common.fail(res.get("error", "Lỗi khi điền text"), window=win, target=ctrl.get("name"), time_ms=res_elapsed_ms)
        is_ok = bool(res.pop("success", True))
        _common.emit(is_ok, window=win, time_ms=res_elapsed_ms, **res)


if __name__ == "__main__":
    main()
