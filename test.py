import ctypes
from ctypes import wintypes
import subprocess

EnumWindows = ctypes.windll.user32.EnumWindows
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
GetWindowText = ctypes.windll.user32.GetWindowTextW
GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
IsWindowVisible = ctypes.windll.user32.IsWindowVisible
GetWindowThreadProcessId = ctypes.windll.user32.GetWindowThreadProcessId
GetWindow = ctypes.windll.user32.GetWindow
GW_OWNER = 4

def get_pids(name):
    pids = []
    try:
        out = subprocess.check_output(['tasklist', '/FI', f'IMAGENAME eq {name}.exe', '/NH', '/FO', 'CSV'], text=True)
        for line in out.strip().splitlines():
            parts = line.split('","')
            if len(parts) > 1:
                pid = parts[1].replace('"', '').strip()
                if pid.isdigit():
                    pids.append(int(pid))
    except Exception:
        pass
    return pids

pids = get_pids('notepad')

def _callback(hwnd, lparam):
    pid = wintypes.DWORD(0)
    GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value in pids:
        length = GetWindowTextLength(hwnd)
        buff = ctypes.create_unicode_buffer(length + 1)
        GetWindowText(hwnd, buff, length + 1)
        title = buff.value
        owner = GetWindow(hwnd, GW_OWNER)
        print(f'HWND: {hwnd}, Title: "{title}", Owner: {owner}, Visible: {IsWindowVisible(hwnd)}')
    return True

EnumWindows(EnumWindowsProc(_callback), 0)
