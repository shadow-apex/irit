import pygetwindow as gw
import time
import sys
import io
import argparse
import subprocess

# Sửa lỗi in tiếng Việt trên console Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def move_active_window(x, y, wait_time=5):
    """Đếm ngược và di chuyển cửa sổ hiện hành (cửa sổ người dùng click vào)"""
    print(f"BẠN CÓ {wait_time} GIÂY ĐỂ CLICK VÀO CỬA SỔ MUỐN DI CHUYỂN...")
    for i in range(wait_time, 0, -1):
        print(f"{i}...")
        time.sleep(1)
        
    win = gw.getActiveWindow()
    if win:
        print(f"Đã tóm được cửa sổ: '{win.title}'")
        win.moveTo(x, y)
        print(f"Đã ném cửa sổ về tọa độ ({x}, {y}) thành công!")
    else:
        print("Không tìm thấy cửa sổ nào được chọn.")

def move_window_by_name(title, x, y):
    """Tìm và di chuyển cửa sổ theo tên"""
    windows = gw.getAllWindows()
    found = False
    for win in windows:
        if title.lower() in win.title.lower():
            print(f"Đã tìm thấy cửa sổ: '{win.title}'")
            win.moveTo(x, y)
            print(f"Đã di chuyển về ({x}, {y})")
            found = True
            break
            
    if not found:
        print(f"Không tìm thấy cửa sổ nào có tên chứa '{title}'.")

def demo_mode(target_name=None):
    """Chế độ biểu diễn ma thuật (mặc định mở Explorer, hoặc tìm theo tên)"""
    win = None
    
    if target_name:
        print(f"Đang tìm cửa sổ '{target_name}' để biểu diễn...")
        windows = gw.getAllWindows()
        for w in windows:
            if target_name.lower() in w.title.lower():
                win = w
                break
    else:
        print("Đang mở File Explorer để biểu diễn mặc định...")
        subprocess.Popen(['explorer.exe', ','])
        time.sleep(1.5)
        win = gw.getActiveWindow()
    
    if win:
        print(f"Đang biểu diễn với: '{win.title}'")
        try:
            win.resizeTo(600, 500)
            win.moveTo(100, 100)
        except: pass
        
        time.sleep(1)
        print("Trượt sang phải...")
        for x in range(100, 800, 20):
            try:
                win.moveTo(x, 100)
                time.sleep(0.01)
            except: pass
        print("Hoàn tất biểu diễn!")
    else:
        if target_name:
            print(f"Lỗi: Không tìm thấy cửa sổ nào chứa tên '{target_name}'. Hãy chắc chắn bạn đã mở nó.")
        else:
            print("Lỗi: Không bắt được cửa sổ biểu diễn.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Công cụ ma thuật điều khiển cửa sổ Windows")
    parser.add_argument("--active", action="store_true", help="Chế độ click chọn cửa sổ (đếm ngược 5s)")
    parser.add_argument("--demo", action="store_true", help="Chạy chế độ biểu diễn (mặc định File Explorer)")
    parser.add_argument("--name", type=str, help="Tên cửa sổ (dùng kết hợp với --demo hoặc chế độ tìm theo tên)", default=None)
    parser.add_argument("-x", type=int, help="Tọa độ X (mặc định 0)", default=0)
    parser.add_argument("-y", type=int, help="Tọa độ Y (mặc định 0)", default=0)
    
    args = parser.parse_args()
    
    if args.demo:
        demo_mode(args.name)
    elif args.active:
        move_active_window(args.x, args.y)
    elif args.name:
        move_window_by_name(args.name, args.x, args.y)
    else:
        # Nếu không truyền tham số nào, mặc định chạy chế độ active
        move_active_window(args.x, args.y)
