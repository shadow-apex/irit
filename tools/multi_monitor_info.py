"""
tools/multi_monitor_info.py — liệt kê màn hình: vị trí, kích thước (pixel vật lý), màn hình chính.

    python tools/multi_monitor_info.py

Thứ tự trong `monitors` chính là chỉ số `--monitor N` của mouse_control.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MONITORINFOF_PRIMARY = 0x1


def get_monitors():
    import ctypes
    from ctypes import wintypes

    _common.dpi_aware()

    class RECT(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                    ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", RECT), ("rcWork", RECT), ("dwFlags", wintypes.DWORD)]

    proc_t = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(RECT), wintypes.LPARAM)
    monitors = []

    def _callback(hmon, _hdc, _lprc, _data):
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        if ctypes.windll.user32.GetMonitorInfoW(ctypes.c_void_p(hmon), ctypes.byref(info)):
            r = info.rcMonitor
            monitors.append({"left": r.left, "top": r.top, "right": r.right, "bottom": r.bottom,
                             "width": r.right - r.left, "height": r.bottom - r.top,
                             "is_primary": bool(info.dwFlags & MONITORINFOF_PRIMARY)})
        return 1

    u = ctypes.windll.user32
    u.EnumDisplayMonitors.argtypes = [wintypes.HDC, ctypes.POINTER(RECT), proc_t, wintypes.LPARAM]
    u.EnumDisplayMonitors.restype = ctypes.c_int
    u.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.POINTER(MONITORINFO)]
    cb = proc_t(_callback)
    u.EnumDisplayMonitors(None, None, cb, 0)
    return {"monitor_count": len(monitors), "monitors": monitors}


if __name__ == "__main__":
    _common.ensure_utf8()
    try:
        _common.emit(True, **get_monitors())
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không liệt kê được màn hình: {e}")
