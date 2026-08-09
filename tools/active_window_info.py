"""
tools/active_window_info.py

Lay thong tin cua so dang duoc focus (dang active): tieu de, ten tien
trinh (.exe), PID, vi tri/kich thuoc. Dung ctypes (user32) de doc
HWND/title + psutil (da co san trong requirements.txt) de tra ten file
thuc thi tu PID.

Day la tool CHI DOC — khong dieu khien man hinh, chuot, ban phim, khong
chup anh, khong goi OmniParser hay bat ky server nao.

FIX (2026):
  - Them try/except o __main__ (truoc day khong co) de khong crash "cam"
    (khong in duoc JSON gi) neu bat ky loi Win32 nao xay ra.
  - Them SetProcessDpiAwareness() — neu khong goi, GetWindowRect() tra ve
    toa do theo he quy dieu ("virtualized") tren man hinh scale
    (125%/150%...), LECH voi he toa do "vat ly" ma pyautogui dung (vd
    trong mouse_control.py, tu dong DPI-aware khi import) — khien AI click
    sai vi tri du da doc dung "rect" tu tool nay. Goi cang som cang tot,
    truoc khi dung bat ky ham user32 nao.

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
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

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
    try:
        result = get_active_window_info()
    except Exception as e:
        result = {"success": False, "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)
