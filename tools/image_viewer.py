import os
import sys
import argparse
import time
import subprocess
import psutil
from glob import glob
import json

CMD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "viewer_cmd.txt")
IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img")

def is_daemon_running():
    for p in psutil.process_iter(['name', 'cmdline']):
        try:
            cmd = p.info.get('cmdline')
            if cmd and 'python' in p.info.get('name', '').lower() and 'image_viewer.py' in ' '.join(cmd) and '--action' in ' '.join(cmd) and 'daemon' in ' '.join(cmd):
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return False

def write_command(cmd):
    with open(CMD_FILE, 'w') as f:
        f.write(cmd)

def run_daemon():
    import tkinter as tk
    from PIL import Image, ImageTk

    root = tk.Tk()
    root.title("Iris Image Viewer")
    root.attributes("-topmost", True)
    
    # Kích thước màn hình
    screen_width = root.winfo_screenwidth()
    screen_height = root.winfo_screenheight()
    
    # Đặt kích thước mặc định và vị trí (Góc phải dưới, nhỏ gọn)
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
        # Lấy tất cả ảnh và sắp xếp theo thời gian mới nhất (mới nhất ở index 0)
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
            # Resize fit window
            image.thumbnail((win_w, win_h), Image.Resampling.LANCZOS)
            photo = ImageTk.PhotoImage(image)
            label.config(image=photo)
            label.image = photo # Giữ reference
            root.title(f"Iris Viewer - {os.path.basename(img_path)} ({index+1}/{len(current_images)})")
        except Exception as e:
            pass

    def poll_commands():
        nonlocal current_index
        if os.path.exists(CMD_FILE):
            try:
                with open(CMD_FILE, 'r') as f:
                    cmd = f.read().strip()
                os.remove(CMD_FILE)
                
                if cmd:
                    refresh_image_list()
                    if cmd == 'latest':
                        show_image(0)
                    elif cmd == 'prev': # prev means older in time, so index + 1
                        if current_index + 1 < len(current_images):
                            show_image(current_index + 1)
                    elif cmd == 'next': # next means newer in time, so index - 1
                        if current_index - 1 >= 0:
                            show_image(current_index - 1)
                    elif cmd == 'close':
                        root.destroy()
                        return
            except:
                pass
        
        root.after(200, poll_commands)

    # Initial load
    refresh_image_list()
    # Không show mặc định nếu mới bật lên, chỉ show khi có lệnh
    
    # Bắt đầu vòng lặp poll
    root.after(200, poll_commands)
    root.mainloop()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Iris Image Viewer Tool")
    parser.add_argument("--action", choices=['latest', 'prev', 'next', 'close', 'daemon'], help="Hành động")
    args = parser.parse_args()

    if not args.action:
        print(json.dumps({"success": False, "error": "Thiếu tham số --action"}))
        sys.exit(1)

    if args.action == 'daemon':
        run_daemon()
    else:
        # Khởi động cửa sổ ngầm (daemon) nếu chưa chạy
        if args.action != 'close' and not is_daemon_running():
            subprocess.Popen([sys.executable, __file__, "--action", "daemon"], 
                             creationflags=subprocess.CREATE_NO_WINDOW) # Ẩn console window
            time.sleep(1.5) # Chờ GUI khởi động
            
        if args.action:
            write_command(args.action)
            print(json.dumps({
                "success": True, 
                "message": f"Đã thực thi lệnh {args.action}",
                "status": "Viewer is now showing the requested image." if args.action != "close" else "Viewer closed."
            }))
