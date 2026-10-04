"""
tools/_winutil.py — liệt kê / chọn cửa sổ Windows bằng ctypes (không PowerShell, không pygetwindow).

Các hàm `select_windows`, `is_self_window` là HÀM THUẦN (test được trên mọi OS).
"""
import os

SW_HIDE, SW_SHOWMINIMIZED, SW_RESTORE = 0, 2, 9
SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW = 0x0001, 0x0004, 0x0040

SELF_EXES = frozenset({"electron.exe", "iris.exe"})
MIN_TITLE_MATCH = 4


def _self_pid():
    try:
        return int(os.environ.get("IRIS_SELF_PID", "0"))
    except ValueError:
        return 0


def is_self_window(win, self_pid=None):
    """True nếu cửa sổ thuộc chính Iris (theo PID Node truyền vào hoặc tên exe của Electron)."""
    sp = _self_pid() if self_pid is None else self_pid
    if sp and win.get("pid") == sp:
        return True
    return str(win.get("exe", "")).lower() in SELF_EXES


def select_windows(windows, target, self_pid=None):
    """Chọn cửa sổ theo `target` (tên exe hoặc một phần tiêu đề).

    1) khớp CHÍNH XÁC tên exe (có/không đuôi .exe);
    2) chỉ khi (1) rỗng: khớp chuỗi con tiêu đề, và target phải dài ≥ MIN_TITLE_MATCH;
    cửa sổ của chính Iris luôn bị loại.
    """
    t = (target or "").strip().lower()
    if not t:
        return []
    t_exe = t if t.endswith(".exe") else t + ".exe"
    candidates = [w for w in windows if not is_self_window(w, self_pid)]
    by_exe = [w for w in candidates if str(w.get("exe", "")).lower() == t_exe]
    if by_exe:
        return by_exe
    bare = t[:-4] if t.endswith(".exe") else t
    if len(bare) < MIN_TITLE_MATCH:
        return []
    return [w for w in candidates if bare in str(w.get("title", "")).lower()]


def exe_name_of(pid):
    try:
        import psutil

        return psutil.Process(pid).name()
    except Exception:
        return ""


def enum_windows(visible_only=True):
    """[{hwnd, pid, title, exe, visible}] — chỉ cửa sổ có tiêu đề."""
    import ctypes
    from ctypes import wintypes

    u = ctypes.windll.user32
    proc_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    u.EnumWindows.argtypes = [proc_t, wintypes.LPARAM]
    u.IsWindowVisible.argtypes = [wintypes.HWND]
    u.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    u.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    out, exe_cache = [], {}

    def cb(hwnd, _lparam):
        visible = bool(u.IsWindowVisible(hwnd))
        if visible_only and not visible:
            return True
        n = u.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        u.GetWindowTextW(hwnd, buf, n + 1)
        pid = wintypes.DWORD(0)
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value not in exe_cache:
            exe_cache[pid.value] = exe_name_of(pid.value)
        out.append({"hwnd": int(hwnd), "pid": int(pid.value), "title": buf.value,
                    "exe": exe_cache[pid.value], "visible": visible})
        return True

    u.EnumWindows(proc_t(cb), 0)
    return out


def window_pid(hwnd):
    import ctypes
    from ctypes import wintypes

    pid = wintypes.DWORD(0)
    ctypes.windll.user32.GetWindowThreadProcessId(wintypes.HWND(hwnd), ctypes.byref(pid))
    return int(pid.value)


def is_window(hwnd):
    import ctypes
    from ctypes import wintypes

    return bool(ctypes.windll.user32.IsWindow(wintypes.HWND(hwnd)))


def show_window(hwnd, cmd):
    import ctypes
    from ctypes import wintypes

    return bool(ctypes.windll.user32.ShowWindowAsync(wintypes.HWND(hwnd), cmd))


def foreground(hwnd):
    import ctypes
    from ctypes import wintypes

    return bool(ctypes.windll.user32.SetForegroundWindow(wintypes.HWND(hwnd)))


def foreground_window():
    """Cửa sổ đang focus dưới dạng dict (hoặc None)."""
    import ctypes
    from ctypes import wintypes

    u = ctypes.windll.user32
    u.GetForegroundWindow.restype = wintypes.HWND
    h = u.GetForegroundWindow()
    if not h:
        return None
    pid = window_pid(int(h))
    n = u.GetWindowTextLengthW(h)
    buf = ctypes.create_unicode_buffer(max(n, 0) + 1)
    u.GetWindowTextW(h, buf, n + 1)
    return {"hwnd": int(h), "pid": pid, "title": buf.value, "exe": exe_name_of(pid), "visible": True}


def get_rect(hwnd):
    import ctypes
    from ctypes import wintypes

    r = wintypes.RECT()
    if not ctypes.windll.user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(r)):
        return None
    return (r.left, r.top, r.right - r.left, r.bottom - r.top)


def move_resize(hwnd, x, y, width=None, height=None):
    """Di chuyển (và đổi kích thước nếu có width/height > 0). Không đổi z-order."""
    import ctypes
    from ctypes import wintypes

    flags = SWP_NOZORDER | SWP_SHOWWINDOW
    w = int(width or 0)
    h = int(height or 0)
    if w <= 0 or h <= 0:
        flags |= SWP_NOSIZE
        w = h = 0
    return bool(ctypes.windll.user32.SetWindowPos(wintypes.HWND(hwnd), None, int(x), int(y), w, h, flags))

