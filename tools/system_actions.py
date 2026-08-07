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
    
    # Tat cua so Notepad cu (neu dang mo file nay) de tranh mo nhieu cua so
    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
    GetWindowText = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
    PostMessage = ctypes.windll.user32.PostMessageW
    
    found_old_note = [False]
    
    def close_old_note(hwnd, lParam):
        length = GetWindowTextLength(hwnd)
        buff = ctypes.create_unicode_buffer(length + 1)
        GetWindowText(hwnd, buff, length + 1)
        title = buff.value.lower()
        if "iris_quick_note" in title:
            PostMessage(hwnd, 0x0010, 0, 0) # Gui lenh tat cua so (WM_CLOSE)
            found_old_note[0] = True
        return True

    EnumWindows(EnumWindowsProc(close_old_note), 0)
    
    # Doi mot chut de cua so cu kip dong lai hoan toan (tranh xung dot)
    if found_old_note[0]:
        time.sleep(0.5)
        
    # Mo cua so Notepad moi (se hien thi ca noi dung cu va moi)
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
