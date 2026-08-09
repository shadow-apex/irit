"""
tools/magic_move.py

Cong cu "ma thuat" dieu khien cua so Windows: bat cua so dang active va
di chuyen (--active), di chuyen theo ten (--name), va vai che do bieu dien
(--demo, --demo2, --setup — CHI dung thu cong/CLI, KHONG duoc wire vao
Electron, xem ghi chu trong electron/main/local-tools.mjs).

FIX (2026):
  - Cac che do --active/--name/--demo (nhung che do THAT SU duoc AI goi
    qua local-tools.mjs) truoc day chi in() text thuong -> nay in DUNG 1
    dong JSON o cuoi, giong moi tool khac trong /tools, de Electron/AI
    doc ket qua on dinh thay vi phai regex text tieng Viet.
  - Them try/except o __main__ de khong crash "cam" (khong in duoc gi) khi
    pygetwindow nem loi (vd PyGetWindowException khi enum cua so that bai).
  - Toa do dich (x, y) nay duoc gioi han (clamp) trong pham vi virtual
    desktop (tinh ca nhieu man hinh) de tranh "nem" cua so ra ngoai moi
    man hinh, khong con cach nao voi lai duoc.
  - Bare `except: pass` (bat ca BaseException, ke ca KeyboardInterrupt) doi
    thanh `except Exception: pass`.

Vi du dung:
    python tools/magic_move.py --active -x 100 -y 100
    python tools/magic_move.py --name notepad -x 100 -y 100
    python tools/magic_move.py --demo
"""
import pygetwindow as gw
import time
import sys
import io
import os
import json
import argparse
import subprocess
import ctypes

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# SM_XVIRTUALSCREEN=76, SM_YVIRTUALSCREEN=77, SM_CXVIRTUALSCREEN=78, SM_CYVIRTUALSCREEN=79
SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN = 76, 77
SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 78, 79


def _clamp_to_virtual_desktop(x, y, margin=50):
    """Gioi han (x, y) trong pham vi toan bo virtual desktop (gop nhieu man
    hinh), chua 1 'margin' px de tranh cua so bi nem hoan toan ra ngoai,
    khong con cach nao keo lai duoc bang chuot."""
    try:
        gm = ctypes.windll.user32.GetSystemMetrics
        vx, vy = gm(SM_XVIRTUALSCREEN), gm(SM_YVIRTUALSCREEN)
        vw, vh = gm(SM_CXVIRTUALSCREEN), gm(SM_CYVIRTUALSCREEN)
        cx = max(vx - margin, min(vx + vw - margin, x))
        cy = max(vy - margin, min(vy + vh - margin, y))
        return int(cx), int(cy)
    except Exception:
        return x, y


def move_active_window(x, y, wait_time=0):
    """Di chuyen cua so hien hanh. Neu wait_time > 0, dem nguoc de nguoi
    dung kip click chon cua so muon di chuyen truoc."""
    if wait_time > 0:
        for i in range(wait_time, 0, -1):
            print(f"{i}...")
            time.sleep(1)

    x, y = _clamp_to_virtual_desktop(x, y)
    win = gw.getActiveWindow()
    if not win:
        return {"success": False, "error": "Khong tim thay cua so nao dang duoc chon/focus."}
    title = win.title
    win.moveTo(x, y)
    return {"success": True, "message": f"Da di chuyen '{title}' den ({x}, {y}).", "title": title}


def move_window_by_name(title, x, y):
    """Tim va di chuyen cua so theo ten (chua 1 phan title, khong phan biet hoa/thuong)."""
    x, y = _clamp_to_virtual_desktop(x, y)
    windows = gw.getAllWindows()
    for win in windows:
        if title.lower() in win.title.lower():
            win.moveTo(x, y)
            return {"success": True, "message": f"Da di chuyen '{win.title}' den ({x}, {y}).", "title": win.title}
    return {"success": False, "error": f"Khong tim thay cua so nao co ten chua '{title}'."}


def demo_mode(target_name=None):
    """Che do bieu dien ma thuat (mac dinh mo Explorer, hoac tim theo ten)."""
    import math
    win = None

    if target_name:
        windows = gw.getAllWindows()
        for w in windows:
            if target_name.lower() in w.title.lower():
                win = w
                break
    else:
        subprocess.Popen(["explorer.exe"])
        time.sleep(1.5)
        win = gw.getActiveWindow()

    if not win:
        if target_name:
            return {"success": False, "error": f"Khong tim thay cua so nao chua ten '{target_name}'."}
        return {"success": False, "error": "Khong bat duoc cua so de bieu dien."}

    try:
        win.resizeTo(500, 400)
        win.moveTo(100, 100)
    except Exception:
        pass

    time.sleep(0.5)

    for i in range(10):
        try:
            win.moveTo(100 + i * 60, 100 if i % 2 == 0 else 300)
            time.sleep(0.04)
        except Exception:
            pass

    for x in range(100, 800, 15):
        y = int(300 + 150 * math.sin(x / 40.0))
        try:
            win.moveTo(x, y)
            time.sleep(0.01)
        except Exception:
            pass

    center_x, center_y = 600, 350
    for angle in range(0, 360 * 3, 15):
        rad = angle * math.pi / 180
        radius = max(0, 250 - (angle / 6))
        x = int(center_x + radius * math.cos(rad))
        y = int(center_y + radius * math.sin(rad))
        try:
            win.moveTo(x, y)
            time.sleep(0.01)
        except Exception:
            pass

    try:
        win.moveTo(250, 150)
        win.resizeTo(800, 600)
    except Exception:
        pass

    return {"success": True, "message": f"Da bieu dien xong voi cua so '{win.title}'.", "title": win.title}


def demo_mode_2():
    """Mo 6 cua so Notepad va xep thang hang. Chi danh cho CLI/thu nghiem
    thu cong, khong duoc AI goi toi."""
    for _ in range(6):
        subprocess.Popen(["notepad.exe"])

    time.sleep(2.5)

    windows = gw.getAllWindows()
    notepad_wins = []
    for w in windows:
        if "notepad" in w.title.lower():
            notepad_wins.append(w)
            if len(notepad_wins) == 6:
                break

    w_width, w_height = 250, 300
    start_x, start_y = 400, 50
    spacing_x, spacing_y = 20, 20

    for i, win in enumerate(notepad_wins):
        row, col = divmod(i, 3)
        try:
            win.resizeTo(w_width, w_height)
            win.moveTo(start_x + col * (w_width + spacing_x), start_y + row * (w_height + spacing_y))
            time.sleep(0.3)
        except Exception:
            pass

    return {"success": True, "message": f"Da xep {len(notepad_wins)} cua so Notepad.", "count": len(notepad_wins)}


def setup_work_mode():
    """Che do setup khong gian lam viec ca nhan (dev-only, khong danh cho AI)."""
    import pyautogui
    pyautogui.hotkey("win", "d")
    time.sleep(1)

    windows = gw.getAllWindows()
    agy_win = None
    for w in windows:
        t_low = w.title.lower()
        if "antigravity" in t_low or "agy" in t_low or "code" in t_low or "cursor" in t_low or "irit" in t_low:
            agy_win = w
            break

    if agy_win:
        try:
            if agy_win.isMinimized:
                agy_win.restore()
            agy_win.maximize()
            agy_win.activate()
        except Exception:
            pass

    subprocess.Popen("start https://claude.ai", shell=True)
    time.sleep(4)

    windows = gw.getAllWindows()
    claude_win = None
    for w in windows:
        if "claude" in w.title.lower():
            claude_win = w
            break

    if claude_win:
        try:
            if claude_win.isMaximized or claude_win.isMinimized:
                claude_win.restore()
            claude_win.resizeTo(250, 300)
            claude_win.moveTo(10, 60)
            claude_win.activate()
        except Exception:
            pass

    return {"success": True, "message": "Da setup khong gian lam viec."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cong cu ma thuat dieu khien cua so Windows")
    parser.add_argument("--active", action="store_true", help="Che do click chon cua so (dem nguoc)")
    parser.add_argument("--demo", action="store_true", help="Chay che do bieu dien (mac dinh File Explorer)")
    parser.add_argument("--demo2", action="store_true", help="Mo 6 cua so Notepad va xep thang hang (CLI-only)")
    parser.add_argument("--setup", action="store_true", help="Setup khong gian lam viec (CLI-only)")
    parser.add_argument("--name", type=str, help="Ten cua so", default=None)
    parser.add_argument("-x", type=int, help="Toa do X", default=0)
    parser.add_argument("-y", type=int, help="Toa do Y", default=0)
    # FIX: local-tools.mjs's moveWindowMagicTool() tells the user "you have 5
    # seconds to click the window you want to move", but the ORIGINAL script
    # had no --wait flag at all, so move_active_window() always ran with
    # wait_time=0 — the promised countdown never actually happened and the
    # window grabbed was whatever was active the instant the process spawned.
    # Default is now 5s to match what the caller already tells the user.
    parser.add_argument("--wait", type=int, help="So giay dem nguoc truoc khi bat cua so active", default=5)

    args = parser.parse_args()

    try:
        if args.demo:
            result = demo_mode(args.name)
        elif args.demo2:
            result = demo_mode_2()
        elif args.setup:
            result = setup_work_mode()
        elif args.name:
            result = move_window_by_name(args.name, args.x, args.y)
        else:
            # --active hoac khong truyen gi -> mac dinh che do active
            result = move_active_window(args.x, args.y, args.wait)
    except Exception as e:
        result = {"success": False, "error": str(e)}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)
