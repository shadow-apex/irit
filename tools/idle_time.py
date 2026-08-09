"""
tools/idle_time.py

Bao thoi gian (giay) tu lan cuoi co thao tac ban phim/chuot, dung Windows
API GetLastInputInfo qua ctypes (khong can cai them thu vien nao).

Vi du dung:
    python tools/idle_time.py
"""
import sys
import io
import json
import ctypes
from ctypes import wintypes

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def get_idle_seconds():
    lii = LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
        return {"success": False, "error": "GetLastInputInfo() that bai."}
    tick_count = ctypes.windll.kernel32.GetTickCount()
    idle_ms = tick_count - lii.dwTime
    return {"success": True, "idle_seconds": round(idle_ms / 1000.0, 1)}


if __name__ == "__main__":
    print(json.dumps(get_idle_seconds()))
