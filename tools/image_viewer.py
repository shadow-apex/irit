"""
tools/image_viewer.py

Cua so xem anh nho ("Iris Image Viewer") o goc man hinh, dieu khien bang
lenh ghi vao 1 file CMD_FILE. Cua so chay nhu 1 tien trinh "daemon" Tkinter
rieng, tach khoi tien trinh goi lenh.

FIX (2026):
  - Thieu io.TextIOWrapper bao boc stdout/stderr (khac moi tool khac trong
    /tools) — da them vao de nhat quan va an toan khi in tieng Viet.
  - RACE CONDITION khi khoi dong daemon: neu 2 lenh (vd 'latest' roi 'next')
    duoc goi lien tiep RAT NHANH (truoc khi daemon dau tien kip khoi dong
    va ghi PID), ca 2 deu thay "chua co daemon" va CUNG spawn 1 daemon moi
    -> 2 cua so Tkinter chong len nhau, cung tranh doc/ghi CMD_FILE. Nay
    dung file PID (giong pattern cua clipboard_history.py) + khoa file cap
    he dieu hanh (msvcrt) bao boc buoc "kiem tra roi spawn" de dam bao chi
    1 daemon duy nhat duoc tao du nhieu lenh goi toi gan nhu cung luc.
  - Daemon co the "crash cam" (vd thieu Pillow/tkinter) ma tien trinh goi
    lenh phia truoc VAN bao "success" vi no chi ghi lenh roi thoat, khong
    biet daemon co that su chay duoc hay khong. Nay bat loi trong
    run_daemon() va ghi ra 1 file loi (DAEMON_ERROR_PATH) de co the kiem
    tra/debug, thay vi mat dau vet hoan toan.
"""
import os
import sys
import io
import argparse
import time
import subprocess
import psutil
import tempfile
import traceback
from glob import glob
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import msvcrt
    _HAS_MSVCRT = True
except ImportError:
    _HAS_MSVCRT = False

CMD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "viewer_cmd.txt")
IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img")
PID_FILE = os.path.join(tempfile.gettempdir(), "iris_image_viewer.pid")
SPAWN_LOCK_FILE = os.path.join(tempfile.gettempdir(), "iris_image_viewer_spawn.lock")
DAEMON_ERROR_PATH = os.path.join(tempfile.gettempdir(), "iris_image_viewer_daemon_error.txt")


def is_daemon_running():
    """Kiem tra PID luu trong PID_FILE con song va dung la tien trinh daemon
    cua tool nay khong (chong 'stale' PID file con lai sau khi daemon bi
    kill cung, vd Task Manager, hoac may tat dot ngot)."""
    if not os.path.exists(PID_FILE):
        return False
    try:
        with open(PID_FILE, "r") as f:
            pid = int(f.read().strip())
    except (ValueError, OSError):
        return False
    try:
        proc = psutil.Process(pid)
        cmdline = " ".join(proc.cmdline()).lower()
        if "image_viewer.py" in cmdline and "daemon" in cmdline:
            return True
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        pass
    # PID file "stale" (tien trinh khong con hoac khong con la daemon nay) — don di.
    try:
        os.remove(PID_FILE)
    except OSError:
        pass
    return False


def write_command(cmd):
    with open(CMD_FILE, "w", encoding="utf-8") as f:
        f.write(cmd)


def run_daemon():
    try:
        with open(PID_FILE, "w") as f:
            f.write(str(os.getpid()))

        import tkinter as tk
        from PIL import Image, ImageTk

        root = tk.Tk()
        root.title("Iris Image Viewer")
        root.attributes("-topmost", True)

        screen_width = root.winfo_screenwidth()
        screen_height = root.winfo_screenheight()

        win_w, win_h = 400, 300
        x = screen_width - win_w - 20
        y = screen_height - win_h - 60
        root.geometry(f"{win_w}x{win_h}+{x}+{y}")

        label = tk.Label(root, bg="black")
        label.pack(expand=True, fill=tk.BOTH)

        current_images = []
        current_index = -1

        def refresh_image_list():
            nonlocal current_images
            if not os.path.exists(IMG_DIR):
                return
            imgs = glob(os.path.join(IMG_DIR, "*.png"))
            imgs.sort(key=os.path.getctime, reverse=True)
            current_images = imgs

        def show_image(index):
            nonlocal current_index
            if not current_images or index < 0 or index >= len(current_images):
                return
            current_index = index
            img_path = current_images[index]
            try:
                image = Image.open(img_path)
                image.thumbnail((win_w, win_h), Image.Resampling.LANCZOS)
                photo = ImageTk.PhotoImage(image)
                label.config(image=photo)
                label.image = photo  # giu reference
                root.title(f"Iris Viewer - {os.path.basename(img_path)} ({index + 1}/{len(current_images)})")
            except Exception:
                pass  # 1 anh loi khong duoc lam sap ca daemon

        def _cleanup_and_exit():
            try:
                os.remove(PID_FILE)
            except OSError:
                pass
            root.destroy()

        def poll_commands():
            nonlocal current_index
            if os.path.exists(CMD_FILE):
                try:
                    with open(CMD_FILE, "r", encoding="utf-8") as f:
                        cmd = f.read().strip()
                    os.remove(CMD_FILE)

                    if cmd:
                        refresh_image_list()
                        if cmd == "latest":
                            show_image(0)
                        elif cmd == "prev":  # cu hon ve thoi gian => index + 1
                            if current_index + 1 < len(current_images):
                                show_image(current_index + 1)
                        elif cmd == "next":  # moi hon ve thoi gian => index - 1
                            if current_index - 1 >= 0:
                                show_image(current_index - 1)
                        elif cmd == "close":
                            _cleanup_and_exit()
                            return
                except Exception:
                    pass  # 1 lenh loi khong duoc lam dung vong poll

            root.after(200, poll_commands)

        root.protocol("WM_DELETE_WINDOW", _cleanup_and_exit)

        refresh_image_list()
        root.after(200, poll_commands)
        root.mainloop()
    except Exception:
        # Truoc day loi o day (vd thieu Pillow/tkinter) bien mat hoan toan —
        # tien trinh goi lenh phia truoc van bao "success" vi khong biet
        # daemon that su co chay duoc khong. Nay ghi traceback ra 1 file de
        # co the kiem tra sau.
        try:
            with open(DAEMON_ERROR_PATH, "w", encoding="utf-8") as f:
                f.write(traceback.format_exc())
        except Exception:
            pass
    finally:
        try:
            if os.path.exists(PID_FILE):
                os.remove(PID_FILE)
        except OSError:
            pass


def _ensure_daemon_started():
    """Kiem tra + spawn daemon (neu can) trong 1 khoa file de tranh 2 lenh
    goi gan nhu cung luc cung nghi 'chua co daemon' va cung spawn."""
    if not _HAS_MSVCRT:
        # Khong phai Windows (vd test tren Linux) — bo qua khoa, best-effort.
        if not is_daemon_running():
            subprocess.Popen(
                [sys.executable, __file__, "--action", "daemon"],
                creationflags=0,
            )
            time.sleep(1.5)
        return

    lock_f = open(SPAWN_LOCK_FILE, "a+b")
    try:
        deadline = time.time() + 5
        while True:
            try:
                msvcrt.locking(lock_f.fileno(), msvcrt.LK_LOCK, 1)
                break
            except OSError:
                if time.time() > deadline:
                    return  # khong lay duoc khoa — bo qua, tranh treo vo han
                time.sleep(0.05)
        try:
            if not is_daemon_running():
                subprocess.Popen(
                    [sys.executable, __file__, "--action", "daemon"],
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                time.sleep(1.5)  # cho GUI khoi dong
        finally:
            lock_f.seek(0)
            msvcrt.locking(lock_f.fileno(), msvcrt.LK_UNLCK, 1)
    finally:
        lock_f.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Iris Image Viewer Tool")
    parser.add_argument("--action", choices=["latest", "prev", "next", "close", "daemon"], help="Hanh dong")
    args = parser.parse_args()

    if not args.action:
        print(json.dumps({"success": False, "error": "Thieu tham so --action"}, ensure_ascii=False))
        sys.exit(1)

    if args.action == "daemon":
        run_daemon()
        sys.exit(0)

    try:
        if args.action != "close":
            _ensure_daemon_started()

        write_command(args.action)
        result = {
            "success": True,
            "message": f"Da thuc thi lenh {args.action}",
            "status": "Viewer is now showing the requested image." if args.action != "close" else "Viewer closed.",
        }
    except Exception as e:
        result = {"success": False, "error": str(e)}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)
