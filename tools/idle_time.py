"""
tools/idle_time.py — số giây kể từ lần cuối có thao tác bàn phím/chuột (GetLastInputInfo).

TL-13: GetLastInputInfo.dwTime là bộ đếm 32-bit; so với GetTickCount64 rồi dùng số học modulo 2^32
nên đúng cả khi máy chạy > 24,8 / 49,7 ngày (bản cũ ra số âm/rác).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MASK32 = 0xFFFFFFFF


def compute_idle_ms(tick64, last_input_dword):
    """Hàm thuần: idle (ms) từ tick 64-bit hiện tại và dwTime 32-bit của lần nhập cuối."""
    return ((int(tick64) & MASK32) - (int(last_input_dword) & MASK32)) & MASK32


def get_idle_seconds():
    import ctypes
    from ctypes import wintypes

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]

    lii = LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
        return None
    ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_ulonglong
    tick64 = ctypes.windll.kernel32.GetTickCount64()
    return round(compute_idle_ms(tick64, lii.dwTime) / 1000.0, 1)


if __name__ == "__main__":
    _common.ensure_utf8()
    secs = get_idle_seconds()
    if secs is None:
        _common.fail("GetLastInputInfo() thất bại.")
    _common.emit(True, idle_seconds=secs)
