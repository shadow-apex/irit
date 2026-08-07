import sys
import os
import subprocess
import tempfile
import ctypes
import time

def close_app(target):
    if not target.lower().endswith('.exe'):
        target += '.exe'
    
    print(f"Closing {target}...")
    result = subprocess.run(["taskkill", "/IM", target, "/F"], capture_output=True, text=True)
    if result.returncode == 0:
        print("Success")
        sys.exit(0)
    else:
        print(f"Failed: {result.stderr}")
        sys.exit(1)

def write_note(text, mode="a"):
    temp_path = os.path.join(tempfile.gettempdir(), "iris_quick_note.txt")
    
    # Ghi noi dung (Append hoac Overwrite tuy mode)
    with open(temp_path, mode, encoding="utf-8") as f:
        f.write("- " + text + "\n")
    
    # Tim cua so Notepad dang mo file nay (neu co)
    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
    GetWindowText = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
    PostMessage = ctypes.windll.user32.PostMessageW
    FindWindowExW = ctypes.windll.user32.FindWindowExW
    SendMessageW = ctypes.windll.user32.SendMessageW
    SetForegroundWindow = ctypes.windll.user32.SetForegroundWindow
    ShowWindowAsync = ctypes.windll.user32.ShowWindowAsync

    FindWindowExW.restype = ctypes.c_void_p
    SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_wchar_p]
    SendMessageW.restype = ctypes.c_void_p

    WM_SETTEXT = 0x000C
    EM_SETSEL = 0x00B1
    EM_SCROLLCARET = 0x00B7
    SW_RESTORE = 9

    existing_hwnd = [None]

    def find_old_note(hwnd, lParam):
        length = GetWindowTextLength(hwnd)
        buff = ctypes.create_unicode_buffer(length + 1)
        GetWindowText(hwnd, buff, length + 1)
        if "iris_quick_note" in buff.value.lower():
            existing_hwnd[0] = hwnd
            return False  # da tim thay, dung enum som cho nhanh
        return True

    EnumWindows(EnumWindowsProc(find_old_note), 0)

    if existing_hwnd[0]:
        hwnd = existing_hwnd[0]
        # Cua so dang mo san: cap nhat truc tiep vao control chua text thay vi
        # dong roi mo lai (cach cu gay chop/giat man hinh moi lan ghi chu).
        # Notepad co dien (Win10 tro xuong) dung class "Edit"; Notepad moi cua
        # Win11 dung "RichEditD2DPT" — thu ca hai.
        hEdit = FindWindowExW(hwnd, None, "Edit", None)
        if not hEdit:
            hEdit = FindWindowExW(hwnd, None, "RichEditD2DPT", None)

        if hEdit:
            with open(temp_path, "r", encoding="utf-8") as f:
                full_text = f.read()
            SendMessageW(hEdit, WM_SETTEXT, 0, full_text)
            # Dua con tro ve cuoi de dong moi nhat luon hien ra, khong can cuon tay
            SendMessageW(hEdit, EM_SETSEL, len(full_text), len(full_text))
            SendMessageW(hEdit, EM_SCROLLCARET, 0, 0)
            ShowWindowAsync(hwnd, SW_RESTORE)
            SetForegroundWindow(hwnd)
            print("Success (updated existing Notepad window)")
            sys.exit(0)

        # Khong nhan dien duoc control text (phien ban Notepad la) -> fallback
        # ve cach cu: dong cua so roi mo lai.
        PostMessage(hwnd, 0x0010, 0, 0)  # WM_CLOSE
        time.sleep(0.5)

    # Chua co cua so nao dang mo -> mo Notepad moi
    subprocess.Popen(["notepad.exe", temp_path])
    print("Success")
    sys.exit(0)

def minimize_app(target):
    target = target.lower().replace('.exe', '')
    
    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
    GetWindowText = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
    IsWindowVisible = ctypes.windll.user32.IsWindowVisible
    GetWindowThreadProcessId = ctypes.windll.user32.GetWindowThreadProcessId
    ShowWindowAsync = ctypes.windll.user32.ShowWindowAsync
    
    # Get PIDs of target app
    pids = []
    try:
        output = subprocess.check_output(["tasklist", "/FI", f"IMAGENAME eq {target}.exe", "/NH", "/FO", "CSV"], text=True)
        for line in output.strip().split('\n'):
            parts = line.split('","')
            if len(parts) > 1:
                pid = parts[1].replace('"', '')
                if pid.isdigit():
                    pids.append(int(pid))
    except Exception:
        pass

    found = False

    def foreach_window(hwnd, lParam):
        nonlocal found
        if IsWindowVisible(hwnd):
            pid = ctypes.c_uint(0)
            GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            
            length = GetWindowTextLength(hwnd)
            buff = ctypes.create_unicode_buffer(length + 1)
            GetWindowText(hwnd, buff, length + 1)
            title = buff.value.lower()
            
            # Match by PID or by title containing the target name
            if (pid.value in pids) or (target in title and len(target) > 2):
                ShowWindowAsync(hwnd, 2) # SW_SHOWMINIMIZED
                found = True
        return True

    EnumWindows(EnumWindowsProc(foreach_window), 0)
    
    if found:
        print("Success")
        sys.exit(0)
    else:
        print("No visible window found.")
        sys.exit(1)

def restore_app(target):
    target = target.lower().replace('.exe', '')
    
    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
    GetWindowText = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
    IsWindowVisible = ctypes.windll.user32.IsWindowVisible
    GetWindowThreadProcessId = ctypes.windll.user32.GetWindowThreadProcessId
    ShowWindowAsync = ctypes.windll.user32.ShowWindowAsync
    SetForegroundWindow = ctypes.windll.user32.SetForegroundWindow
    
    pids = []
    try:
        output = subprocess.check_output(["tasklist", "/FI", f"IMAGENAME eq {target}.exe", "/NH", "/FO", "CSV"], text=True)
        for line in output.strip().split('\n'):
            parts = line.split('","')
            if len(parts) > 1:
                pid = parts[1].replace('"', '')
                if pid.isdigit():
                    pids.append(int(pid))
    except Exception:
        pass

    found = False

    def foreach_window(hwnd, lParam):
        nonlocal found
        if IsWindowVisible(hwnd):
            pid = ctypes.c_uint(0)
            GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            
            length = GetWindowTextLength(hwnd)
            buff = ctypes.create_unicode_buffer(length + 1)
            GetWindowText(hwnd, buff, length + 1)
            title = buff.value.lower()
            
            if (pid.value in pids) or (target in title and len(target) > 2):
                ShowWindowAsync(hwnd, 9) # SW_RESTORE
                SetForegroundWindow(hwnd)
                found = True
        return True

    EnumWindows(EnumWindowsProc(foreach_window), 0)
    
    if found:
        print("Success")
        sys.exit(0)
    else:
        print("No visible window found.")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python system_actions.py <action> <args...>")
        sys.exit(1)
        
    action = sys.argv[1]
    
    if action == "close":
        close_app(sys.argv[2])
    elif action == "minimize":
        minimize_app(sys.argv[2])
    elif action == "restore":
        restore_app(sys.argv[2])
    elif action == "note":
        # Check if --new flag is passed
        mode = "w" if len(sys.argv) > 3 and sys.argv[3] == "--new" else "a"
        write_note(sys.argv[2], mode)
    else:
        print("Unknown action")
        sys.exit(1)
