"""
tools/move_window.py

Di chuyen / doi kich thuoc cua so ung dung theo tieu de (title chua 1 phan
ten). LUU Y: tool nay hien KHONG duoc wire vao electron/main/local-tools.mjs
(magic_move.py duoc dung thay the, xem ghi chu trong local-tools.mjs) —
giu lai de dung doc lap/CLI hoac cho muc dich tuong lai.

FIX BAO MAT (2026): ban truoc day nhung 'window_title' TRUC TIEP vao 1
chuoi PowerShell/C# roi chay qua subprocess — neu title chua dau nhay don
(') se "thoat" khoi chuoi PowerShell va CHO PHEP CHAY LENH TUY Y (command
injection). Ban nay bo hoan toan PowerShell/C#, dung thang ctypes goi
user32.dll (SetWindowPos/EnumWindows) tu Python — vua an toan (khong con
chuoi lenh nao de "thoat" ra duoc) vua nhanh hon nhieu (khong ton thoi
gian khoi dong powershell.exe + biên dich C# moi lan goi).

Vi du dung:
    python tools/move_window.py "notepad" 100 100
    python tools/move_window.py "notepad" 100 100 --width 800 --height 600
"""
import sys
import io
import json
import argparse
import ctypes
from ctypes import wintypes

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


def _find_window(title_contains):
    """Duyet cua so top-level dang hien thi, tra ve hwnd dau tien co tieu de
    chua 'title_contains' (khong phan biet hoa/thuong), hoac None."""
    user32 = ctypes.windll.user32
    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    found = [None]
    found_title = [None]
    needle = title_contains.lower()

    def _callback(hwnd, lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        if needle in buff.value.lower():
            found[0] = hwnd
            found_title[0] = buff.value
            return False  # dung enum, da tim thay
        return True

    user32.EnumWindows(EnumWindowsProc(_callback), 0)
    return found[0], found_title[0]


def move_window(title, x, y, width=None, height=None):
    hwnd, matched_title = _find_window(title)
    if not hwnd:
        return {"success": False, "error": f"Khong tim thay cua so nao chua tieu de '{title}'."}

    user32 = ctypes.windll.user32
    if width is None or height is None:
        rect = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        if width is None:
            width = rect.right - rect.left
        if height is None:
            height = rect.bottom - rect.top

    SWP_SHOWWINDOW = 0x0040
    ok = user32.SetWindowPos(hwnd, None, x, y, width, height, SWP_SHOWWINDOW)
    if not ok:
        return {"success": False, "error": f"SetWindowPos() that bai cho cua so '{matched_title}'."}
    return {
        "success": True,
        "message": f"Da di chuyen '{matched_title}' den ({x}, {y}), kich thuoc {width}x{height}.",
        "title": matched_title,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Di chuyen va thay doi kich thuoc cua so ung dung tren Windows")
    parser.add_argument("title", help="Tieu de (hoac mot phan tieu de) cua cua so ung dung")
    parser.add_argument("x", type=int, help="Toa do X tren man hinh")
    parser.add_argument("y", type=int, help="Toa do Y tren man hinh")
    parser.add_argument("--width", type=int, help="Chieu rong moi (tuy chon)", default=None)
    parser.add_argument("--height", type=int, help="Chieu cao moi (tuy chon)", default=None)

    args = parser.parse_args()
    try:
        result = move_window(args.title, args.x, args.y, args.width, args.height)
    except Exception as e:
        result = {"success": False, "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)
