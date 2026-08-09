"""
tools/active_window_info.py

Lay thong tin cua so dang duoc focus (dang active): tieu de, ten tien
trinh (.exe), PID, vi tri/kich thuoc. Dung ctypes (user32) de doc
HWND/title + psutil (da co san trong requirements.txt) de tra ten file
thuc thi tu PID.

Day la tool CHI DOC — khong dieu khien man hinh, chuot, ban phim, khong
chup anh, khong goi OmniParser hay bat ky server nao. Vi vay no KHONG
xung dot voi OmniParser/computer-use hay cac vong lap vision (toggle_
screen_vision...): khong tranh chap tai nguyen, khong lock, chi doc 3 Win32
API cuc nhe roi tra ve ngay lap tuc.

Vi du dung:
    python tools/active_window_info.py
"""
import sys
import io
import json
import ctypes
from ctypes import wintypes

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import psutil
except ImportError:
    print(json.dumps({"success": False, "error": "Thieu thu vien psutil. Chay: pip install -r tools/requirements.txt"}))
    sys.exit(1)


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


def get_active_window_info():
    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return {"success": False, "error": "Khong tim thay cua so nao dang duoc focus."}

    length = user32.GetWindowTextLengthW(hwnd)
    buff = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buff, length + 1)
    title = buff.value

    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

    exe_name = None
    exe_path = None
    try:
        proc = psutil.Process(pid.value)
        exe_name = proc.name()
        exe_path = proc.exe()
    except Exception:
        pass

    rect = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))

    return {
        "success": True,
        "title": title,
        "pid": pid.value,
        "process_name": exe_name,
        "process_path": exe_path,
        "rect": {"left": rect.left, "top": rect.top, "right": rect.right, "bottom": rect.bottom},
        "width": rect.right - rect.left,
        "height": rect.bottom - rect.top,
    }


if __name__ == "__main__":
    print(json.dumps(get_active_window_info(), ensure_ascii=False))
