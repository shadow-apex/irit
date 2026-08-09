"""
tools/multi_monitor_info.py

Liet ke toan bo man hinh (monitor) dang gan vao may: vi tri, kich thuoc,
man hinh nao la man hinh chinh (primary). Dung Windows API
EnumDisplayMonitors qua ctypes (khong can cai them thu vien nao) — giup
cac tool toa do khac (mouse_control.py, magic_move.py) biet chinh xac
pham vi toa do tren tung man hinh khi may co nhieu man hinh.

Vi du dung:
    python tools/multi_monitor_info.py
"""
import sys
import io
import json
import ctypes
from ctypes import wintypes

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", RECT),
        ("rcWork", RECT),
        ("dwFlags", wintypes.DWORD),
    ]


MONITORINFOF_PRIMARY = 0x1

MonitorEnumProc = ctypes.WINFUNCTYPE(
    ctypes.c_int,             # BOOL return
    ctypes.c_void_p,          # HMONITOR
    ctypes.c_void_p,          # HDC
    ctypes.POINTER(RECT),     # LPRECT
    wintypes.LPARAM,          # LPARAM
)


def get_monitors():
    monitors = []

    def _callback(hMonitor, hdcMonitor, lprcMonitor, dwData):
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        if ctypes.windll.user32.GetMonitorInfoW(hMonitor, ctypes.byref(info)):
            r = info.rcMonitor
            monitors.append({
                "left": r.left, "top": r.top, "right": r.right, "bottom": r.bottom,
                "width": r.right - r.left, "height": r.bottom - r.top,
                "is_primary": bool(info.dwFlags & MONITORINFOF_PRIMARY),
            })
        return 1

    user32 = ctypes.windll.user32
    user32.EnumDisplayMonitors.argtypes = [wintypes.HDC, ctypes.POINTER(RECT), MonitorEnumProc, wintypes.LPARAM]
    user32.EnumDisplayMonitors.restype = ctypes.c_int

    callback = MonitorEnumProc(_callback)
    user32.EnumDisplayMonitors(None, None, callback, 0)

    return {"success": True, "monitor_count": len(monitors), "monitors": monitors}


if __name__ == "__main__":
    print(json.dumps(get_monitors()))
