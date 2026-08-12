"""
tools/system_actions.py

Dieu khien cua so cua UNG DUNG KHAC: dong (close), an (hide), thu nho
(minimize), phuc hoi/mo lai (restore), va ghi note nhanh vao Notepad.
Dung ctypes (user32) de enum cua so + tasklist/taskkill cho phan tien trinh.

FIX (2026) #1: truoc day file nay chi in text thuong va khong co try/except
o muc cao nhat -> neu co loi bat ngo, script crash va KHONG in duoc gi ca,
lam electron/main/computer-use-tools.mjs (ben goi) khong biet duoc ket qua
that su. Nay moi ham deu tra ve 1 dict va duoc bao boc trong try/except o
__main__, luon luon in DUNG 1 dong JSON (giong cac tool khac trong /tools).

FIX (2026) #2 — "an" (hide) vs "thu nho" (minimize) vs "dong" (close) bi
lam lan nhau:
  - Truoc day KHONG co khai niem "an" (hide) that su nao ca — chi co
    minimize (SW_SHOWMINIMIZED, van thay icon tren taskbar) va close
    (taskkill, tat han tien trinh). Cau lenh AI phia Electron lai mo ta
    minimize_app la "invoke khi nguoi dung noi hide HOAC minimize", nen AI
    khong phan biet duoc "an" voi "thu nho" — va khi khong chac, nhieu luc
    lai chon nham close_app khien "an" thanh "dong app" (dung nhu loi
    nguoi dung gap phai).
    -> Them ham hide_app() moi, dung SW_HIDE that su (an khoi man hinh VA
       khoi taskbar/Alt-Tab, khong dong tien trinh). minimize_app() giu
       nguyen SW_SHOWMINIMIZED (thu nho, van thay o taskbar).
  - _enum_visible_windows() (cu) chi duyet cua so co IsWindowVisible=True.
    Neu dung ham nay cho restore_app(), mot cua so DA BI AN (SW_HIDE ->
    IsWindowVisible tra ve False) se KHONG BAO GIO duoc tim thay nua ->
    "mo lai" mot app da "an" se luon that bai. Da doi ten thanh
    _enum_windows() + them tham so require_visible (mac dinh True, dung
    cho minimize_app/hide_app vi chi nen tac dong len cua so DANG hien
    thi), va restore_app() goi voi require_visible=False de tim duoc ca
    cua so dang bi an lan dang bi thu nho.

Vi du dung:
    python tools/system_actions.py close chrome
    python tools/system_actions.py hide notepad
    python tools/system_actions.py minimize notepad
    python tools/system_actions.py restore notepad
    python tools/system_actions.py note "Ghi chu nhanh" [--new]
"""
import sys
import io
import os
import json
import subprocess
import tempfile
import ctypes
from ctypes import wintypes
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

# DPI awareness: neu process nay khong khai bao DPI-aware, GetWindowRect/
# EnumWindows tra toa do theo he quy dieu (virtualized) tren man hinh scale
# (125%/150%...), lech voi toa do "vat ly" ma mouse_control.py/pyautogui
# dung (pyautogui tu goi SetProcessDPIAware khi import). Goi som nhat co the,
# truoc khi dung bat ky ham user32 nao, de dong bo he toa do giua cac tool.
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def _run_subprocess(args, timeout=10):
    """subprocess.run wrapper dung UTF-8 + errors=replace de khong crash
    khi console Windows (vd. tieng Viet) tra ve output khong phai UTF-8."""
    return subprocess.run(
        args, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=timeout,
    )


def _enum_windows(target, pids, on_match, require_visible=True):
    """Duyet toan bo cua so top-level, goi on_match(hwnd) cho moi cua so
    khop theo PID hoac tieu de chua ten 'target'. Tra ve so luong cua so
    da khop.

    require_visible=True (mac dinh): CHI xet cua so dang IsWindowVisible
    (dung cho minimize_app/hide_app — chi nen tac dong len thu dang thay
    tren man hinh). require_visible=False: xet CA cua so dang bi an
    (SW_HIDE -> IsWindowVisible=False) lan dang thu nho — bat buoc phai
    dung False cho restore_app(), neu khong "mo lai" mot app da bi "an"
    se khong bao gio tim thay cua so cua no nua."""
    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    GetWindowText = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
    IsWindowVisible = ctypes.windll.user32.IsWindowVisible
    GetWindowThreadProcessId = ctypes.windll.user32.GetWindowThreadProcessId

    matched = [0]

    def _callback(hwnd, lparam):
        if require_visible and not IsWindowVisible(hwnd):
            return True

        length = GetWindowTextLength(hwnd)
        if length == 0:
            return True  # Bo qua cac cua so shadow/helper khong co tieu de de tranh loi an mat ung dung

        pid = wintypes.DWORD(0)
        GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        buff = ctypes.create_unicode_buffer(length + 1)
        GetWindowText(hwnd, buff, length + 1)
        title = buff.value.lower()

        if (pid.value in pids) or (target in title and len(target) > 2):
            on_match(hwnd)
            matched[0] += 1
        return True

    EnumWindows(EnumWindowsProc(_callback), 0)
    return matched[0]


def close_app(target):
    if not target.lower().endswith(".exe"):
        target += ".exe"
    try:
        result = _run_subprocess(["taskkill", "/IM", target, "/F"])
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"Het thoi gian cho khi dong {target}."}
    if result.returncode == 0:
        return {"success": True, "message": f"Da dong {target}."}
    return {"success": False, "error": result.stderr.strip() or f"Khong the dong {target} (co the khong dang chay)."}


def _get_pids_by_name(target):
    """Tra ve danh sach PID cua tien trinh theo ten .exe, dung tasklist."""
    pids = []
    try:
        result = _run_subprocess(["tasklist", "/FI", f"IMAGENAME eq {target}.exe", "/NH", "/FO", "CSV"])
        for line in result.stdout.strip().splitlines():
            parts = line.split('","')
            if len(parts) > 1:
                pid = parts[1].replace('"', "").strip()
                if pid.isdigit():
                    pids.append(int(pid))
    except Exception:
        pass
    return pids


def minimize_app(target):
    """Thu nho cua so xuong taskbar (SW_MINIMIZE) — van thay icon o
    taskbar, KHAC voi hide_app() (an hoan toan, khong con icon nao ca)."""
    target = target.lower().replace(".exe", "")
    ShowWindowAsync = ctypes.windll.user32.ShowWindowAsync
    SW_MINIMIZE = 6
    pids = _get_pids_by_name(target)
    count = _enum_windows(target, pids, lambda hwnd: ShowWindowAsync(hwnd, SW_MINIMIZE), require_visible=True)
    if count:
        return {"success": True, "message": f"Da thu nho {count} cua so cua '{target}' xuong taskbar."}
    return {"success": False, "error": f"Khong tim thay cua so nao dang hien thi cua '{target}'."}


def hide_app(target):
    """An hoan toan cua so (SW_HIDE) — bien mat khoi man hinh VA khoi
    taskbar/Alt-Tab, nhung tien trinh VAN chay ngam. Muon lay lai thi phai
    goi restore_app() (hoac lenh 'mo lai'), KHONG the tu bam vao taskbar
    duoc nua vi cua so khong con hien dien o do."""
    target = target.lower().replace(".exe", "")
    ShowWindowAsync = ctypes.windll.user32.ShowWindowAsync
    SW_HIDE = 0
    pids = _get_pids_by_name(target)
    count = _enum_windows(target, pids, lambda hwnd: ShowWindowAsync(hwnd, SW_HIDE), require_visible=True)
    if count:
        return {"success": True, "message": f"Da an {count} cua so cua '{target}'. Ung dung van chay ngam, noi 'mo lai {target}' de hien lai."}
    return {"success": False, "error": f"Khong tim thay cua so nao dang hien thi cua '{target}' de an (co the da dang bi an/thu nho san, hoac chua chay)."}


def restore_app(target):
    """Mo lai / phuc hoi cua so ve trang thai binh thuong + dua len tren
    cung (SW_RESTORE + SetForegroundWindow). Dung chung cho ca 2 truong
    hop: cua so dang bi THU NHO (minimize) va cua so dang bi AN (hide) —
    vi vay phai duyet voi require_visible=False, neu khong se khong tim
    thay duoc cua so da bi hide_app() an di."""
    target = target.lower().replace(".exe", "")
    ShowWindowAsync = ctypes.windll.user32.ShowWindowAsync
    SetForegroundWindow = ctypes.windll.user32.SetForegroundWindow
    SW_RESTORE = 9

    def _restore(hwnd):
        ShowWindowAsync(hwnd, SW_RESTORE)
        SetForegroundWindow(hwnd)

    pids = _get_pids_by_name(target)
    count = _enum_windows(target, pids, _restore, require_visible=False)
    if count:
        return {"success": True, "message": f"Da mo lai {count} cua so cua '{target}'."}
    return {"success": False, "error": f"Khong tim thay cua so nao cua '{target}' dang chay."}


def write_note(text, mode="a"):
    temp_path = os.path.join(tempfile.gettempdir(), "iris_quick_note.txt")

    with open(temp_path, mode, encoding="utf-8") as f:
        f.write("- " + text + "\n")

    EnumWindows = ctypes.windll.user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    GetWindowText = ctypes.windll.user32.GetWindowTextW
    GetWindowTextLength = ctypes.windll.user32.GetWindowTextLengthW
    PostMessage = ctypes.windll.user32.PostMessageW
    FindWindowExW = ctypes.windll.user32.FindWindowExW
    SendMessageW = ctypes.windll.user32.SendMessageW
    SetForegroundWindow = ctypes.windll.user32.SetForegroundWindow
    ShowWindowAsync = ctypes.windll.user32.ShowWindowAsync

    FindWindowExW.restype = ctypes.c_void_p
    FindWindowExW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.LPCWSTR, wintypes.LPCWSTR]
    SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_wchar_p]
    SendMessageW.restype = ctypes.c_void_p

    WM_SETTEXT = 0x000C
    EM_SETSEL = 0x00B1
    EM_SCROLLCARET = 0x00B7
    SW_RESTORE = 9

    existing_hwnd = [None]

    def find_old_note(hwnd, lparam):
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
        
        import pyautogui
        import pyperclip
        
        ShowWindowAsync(hwnd, SW_RESTORE)
        SetForegroundWindow(hwnd)
        time.sleep(0.5)

        # Click vao giua cua so de focus text
        rect = wintypes.RECT()
        GetWindowRect = ctypes.windll.user32.GetWindowRect
        if GetWindowRect(hwnd, ctypes.byref(rect)):
            cx = (rect.left + rect.right) // 2
            cy = (rect.top + rect.bottom) // 2
            pyautogui.click(cx, cy)
            time.sleep(0.2)

        # Lay do dai van ban hien tai de biet can nhan bao nhieu lan Backspace
        WM_GETTEXTLENGTH = 0x000E
        text_length = 50
        hEdit = FindWindowExW(hwnd, None, "Edit", None)
        if not hEdit:
            hEdit = FindWindowExW(hwnd, None, "RichEditD2DPT", None)
        if hEdit:
            text_length = SendMessageW(hEdit, WM_GETTEXTLENGTH, 0, 0)

        with open(temp_path, "r", encoding="utf-8") as f:
            full_text = f.read()

        if mode == "w":
            # Hieu ung xoa lùi tung chu giong y nhu nguoi that
            pyautogui.hotkey("ctrl", "end")
            time.sleep(0.2)
            if text_length > 0:
                pyautogui.press("backspace", presses=text_length, interval=0.01)
            else:
                # Fallback neu khong lay duoc length
                pyautogui.hotkey("ctrl", "a")
                pyautogui.press("backspace")
            time.sleep(0.2)
        else:
            pyautogui.hotkey("ctrl", "end")
            time.sleep(0.2)
            pyautogui.press("enter")
        
        # Paste noi dung moi
        pyperclip.copy(full_text)
        pyautogui.hotkey("ctrl", "v")

        return {"success": True, "message": "Da ghi chu vao Notepad (hieu ung xoa tung chu)."}

    try:
        subprocess.Popen(["notepad.exe", temp_path])
    except Exception as e:
        return {"success": False, "error": f"Da ghi vao file nhung khong mo duoc Notepad: {e}"}
    return {"success": True, "message": "Da ghi ghi chu va mo Notepad."}


if __name__ == "__main__":
    try:
        if len(sys.argv) < 3:
            print(json.dumps({"success": False, "error": "Usage: python system_actions.py <close|minimize|restore|note> <args...>"}, ensure_ascii=False))
            sys.exit(1)

        action = sys.argv[1]

        if action == "close":
            out = close_app(sys.argv[2])
        elif action == "hide":
            out = hide_app(sys.argv[2])
        elif action == "minimize":
            out = minimize_app(sys.argv[2])
        elif action == "restore":
            out = restore_app(sys.argv[2])
        elif action == "note":
            mode = "w" if len(sys.argv) > 3 and sys.argv[3] == "--new" else "a"
            out = write_note(sys.argv[2], mode)
        else:
            out = {"success": False, "error": f"Unknown action '{action}'."}

        print(json.dumps(out, ensure_ascii=False))
        sys.exit(0 if out.get("success") else 1)
    except Exception as e:
        # Bat toan bo loi khong luong truoc de KHONG BAO GIO thoat ra ngoai
        # ma khong in JSON — day la yeu cau bat buoc de Electron/AI luon
        # doc duoc ket qua thay vi 1 traceback tho.
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
