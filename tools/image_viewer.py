"""
tools/image_viewer.py — cửa sổ xem ảnh nhỏ (Tk) cho NGƯỜI DÙNG: latest | prev | next | close.

    python tools/image_viewer.py --action latest [--dir <thư mục ảnh>]

TL-11:
 * Cùng thư mục với nơi lưu ảnh chụp (--dir / IRIS_SCREENSHOT_DIR / <userData>/screenshots), đọc cả jpg/png.
 * Thiếu Pillow/tkinter ⇒ báo lỗi THẬT (JSON) thay vì chết im; chỉ báo success khi daemon đã sẵn sàng
   (file trạng thái do daemon ghi) và có ảnh để hiện.
 * Kênh lệnh nằm trong thư mục dữ liệu của Iris (ghi atomic), không còn là file cạnh script.
 * Công cụ này chỉ HIỂN THỊ cho người dùng — nó KHÔNG đưa ảnh cho Gemini (dùng take_ai_screenshot).
"""
import json
import os
import subprocess
import sys
import time
from glob import glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

IMAGE_PATTERNS = ("*.png", "*.jpg", "*.jpeg")


# --------------------------------------------------------------------- hàm thuần
def list_images(directory):
    """Ảnh trong thư mục, mới nhất trước."""
    files = []
    for pat in IMAGE_PATTERNS:
        files.extend(glob(os.path.join(directory, pat)))
    files.sort(key=os.path.getmtime, reverse=True)
    return files


def step_index(current, count, command):
    """latest→0; prev→cũ hơn (+1); next→mới hơn (-1). Trả về chỉ số mới hoặc None nếu không đổi được."""
    if count <= 0:
        return None
    if command == "latest":
        return 0
    if command == "prev" and current + 1 < count:
        return current + 1
    if command == "next" and current - 1 >= 0:
        return current - 1
    return None


def _paths():
    d = _common.user_data_dir()
    return os.path.join(d, "viewer_cmd.txt"), os.path.join(d, "viewer_ready.json")


def _write_cmd(cmd):
    path = _paths()[0]
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(cmd)
    os.replace(tmp, path)


def daemon_alive():
    try:
        import psutil

        with open(_paths()[1], "r", encoding="utf-8") as f:
            pid = int(json.load(f)["pid"])
        cmd = " ".join(psutil.Process(pid).cmdline())
        return "image_viewer.py" in cmd and "daemon" in cmd
    except Exception:
        return False


# --------------------------------------------------------------------- daemon Tk
def run_daemon(img_dir):
    import tkinter as tk
    from PIL import Image, ImageTk

    cmd_file, ready_file = _paths()
    root = tk.Tk()
    root.title("Iris Image Viewer")
    root.attributes("-topmost", True)
    win_w, win_h = 400, 300
    root.geometry(f"{win_w}x{win_h}+{root.winfo_screenwidth() - win_w - 20}+{root.winfo_screenheight() - win_h - 60}")
    label = tk.Label(root, bg="black")
    label.pack(expand=True, fill=tk.BOTH)
    state = {"images": [], "index": -1}

    def show(i):
        imgs = state["images"]
        if not 0 <= i < len(imgs):
            return
        state["index"] = i
        try:
            image = Image.open(imgs[i])
            image.thumbnail((root.winfo_width() or win_w, root.winfo_height() or win_h), Image.Resampling.LANCZOS)
            photo = ImageTk.PhotoImage(image)
            label.config(image=photo)
            label.image = photo
            root.title(f"Iris Viewer — {os.path.basename(imgs[i])} ({i + 1}/{len(imgs)})")
        except Exception:
            pass

    def poll():
        if os.path.exists(cmd_file):
            try:
                with open(cmd_file, "r", encoding="utf-8") as f:
                    cmd = f.read().strip()
                os.remove(cmd_file)
            except Exception:
                cmd = ""
            if cmd == "close":
                root.destroy()
                return
            if cmd:
                state["images"] = list_images(img_dir)
                new = step_index(state["index"], len(state["images"]), cmd)
                if new is not None:
                    show(new)
        root.after(200, poll)

    with open(ready_file, "w", encoding="utf-8") as f:
        json.dump({"pid": os.getpid(), "dir": img_dir}, f)
    root.after(200, poll)
    try:
        root.mainloop()
    finally:
        try:
            os.remove(ready_file)
        except OSError:
            pass


def resolve_dir(arg_dir):
    return arg_dir or os.environ.get("IRIS_SCREENSHOT_DIR") or os.path.join(_common.user_data_dir(), "screenshots")


def build_parser():
    p = _common.ArgParser(description="Iris Image Viewer")
    p.add_argument("--action", choices=["latest", "prev", "next", "close", "daemon"], required=True)
    p.add_argument("--dir", type=str, default=None)
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    img_dir = resolve_dir(a.dir)
    if a.action == "daemon":
        run_daemon(img_dir)
        sys.exit(0)
    if a.action == "close":
        if daemon_alive():
            _write_cmd("close")
        _common.emit(True, message="Đã đóng cửa sổ xem ảnh.")
    _common.require("PIL", "Pillow")
    try:
        import tkinter  # noqa: F401
    except ImportError:
        _common.fail("Thiếu tkinter (cài kèm Python bản đầy đủ) nên không mở được cửa sổ xem ảnh.")
    images = list_images(img_dir)
    if not images:
        _common.fail(f"Chưa có ảnh nào trong '{img_dir}'. Hãy gọi take_ai_screenshot với save=true trước.")
    if not daemon_alive():
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.Popen([sys.executable, os.path.abspath(__file__), "--action", "daemon", "--dir", img_dir],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=flags)
        for _ in range(24):
            time.sleep(0.25)
            if daemon_alive():
                break
        else:
            _common.fail("Cửa sổ xem ảnh không khởi động được (daemon không báo sẵn sàng).")
    _write_cmd(a.action)
    _common.emit(True, message=f"Đã gửi lệnh '{a.action}' tới cửa sổ xem ảnh.", images=len(images), dir=img_dir)
