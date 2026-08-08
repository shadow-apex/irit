import pygetwindow as gw
import time
import sys
import io
import argparse
import subprocess

# Sửa lỗi in tiếng Việt trên console Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def move_active_window(x, y, wait_time=0):
    """Di chuyển ngay cửa sổ hiện hành (không cần đếm ngược)"""
    if wait_time > 0:
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
    import math
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
        subprocess.Popen(['explorer.exe'])
        time.sleep(1.5)
        win = gw.getActiveWindow()
    
    if win:
        print(f"Đang biểu diễn với: '{win.title}'")
        try:
            win.resizeTo(500, 400)
            win.moveTo(100, 100)
        except: pass
        
        time.sleep(0.5)
        
        # Di chuyển dích dắc nhanh
        print("Ziczac siêu tốc...")
        for i in range(10):
            try:
                win.moveTo(100 + i*60, 100 if i%2==0 else 300)
                time.sleep(0.04)
            except: pass
            
        # Hình sin (lượn sóng)
        print("Lượn sóng đại dương...")
        for x in range(100, 800, 15):
            y = int(300 + 150 * math.sin(x / 40.0))
            try:
                win.moveTo(x, y)
                time.sleep(0.01)
            except: pass
            
        # Vòng tròn xoắn ốc ma thuật
        print("Xoắn ốc không gian...")
        center_x, center_y = 600, 350
        for angle in range(0, 360 * 3, 15):
            rad = angle * math.pi / 180
            radius = 250 - (angle / 6)  # Thu nhỏ dần
            if radius < 0: radius = 0
            x = int(center_x + radius * math.cos(rad))
            y = int(center_y + radius * math.sin(rad))
            try:
                win.moveTo(x, y)
                time.sleep(0.01)
            except: pass
            
        # Phóng to và quay về giữa
        try:
            win.moveTo(250, 150)
            win.resizeTo(800, 600)
        except: pass
        
        print("Hoàn tất màn ảo thuật!")
    else:
        if target_name:
            print(f"Lỗi: Không tìm thấy cửa sổ nào chứa tên '{target_name}'. Hãy chắc chắn bạn đã mở nó.")
        else:
            print("Lỗi: Không bắt được cửa sổ biểu diễn.")

def demo_mode_2():
    """Mở 6 cửa sổ Notepad và xếp thẳng hàng gọn gàng như phim viễn tưởng"""
    print("Khởi động Demo 2: Triệu hồi 6 cửa sổ Notepad...")
    for i in range(6):
        subprocess.Popen(['notepad.exe'])
    
    print("Đang chờ các cửa sổ xuất hiện...")
    time.sleep(2.5)
    
    windows = gw.getAllWindows()
    notepad_wins = []
    for w in windows:
        if 'notepad' in w.title.lower():
            notepad_wins.append(w)
            if len(notepad_wins) == 6:
                break
                
    print(f"Đã tìm thấy {len(notepad_wins)} cửa sổ Notepad. Bắt đầu dàn trận...")
    
    w_width, w_height = 250, 300
    start_x, start_y = 400, 50
    spacing_x = 20
    spacing_y = 20
    
    for i, win in enumerate(notepad_wins):
        row = i // 3
        col = i % 3
        try:
            win.resizeTo(w_width, w_height)
            target_x = start_x + col * (w_width + spacing_x)
            target_y = start_y + row * (w_height + spacing_y)
            win.moveTo(target_x, target_y)
            time.sleep(0.3)
        except: pass
            
    print("Dàn trận thành công!")

def setup_work_mode():
    """Chế độ tự động setup không gian làm việc: Antigravity toàn màn hình, Claude ở góc trái"""
    import pyautogui
    print("Đang dọn dẹp không gian làm việc...")
    
    # 1. Thu nhỏ tất cả các cửa sổ (Show Desktop)
    pyautogui.hotkey('win', 'd')
    time.sleep(1)
    
    # 2. Tìm và phóng to Antigravity IDE
    windows = gw.getAllWindows()
    agy_win = None
    
    print("Danh sách cửa sổ hiện tại (để debug):")
    for w in windows:
        if w.title.strip():
            print(f" - {w.title}")
            
    for w in windows:
        t_low = w.title.lower()
        if 'antigravity' in t_low or 'agy' in t_low or 'code' in t_low or 'cursor' in t_low or 'irit' in t_low:
            agy_win = w
            break
            
    if agy_win:
        print(f"Đã tìm thấy IDE: {agy_win.title}")
        try:
            if agy_win.isMinimized:
                agy_win.restore()
            agy_win.maximize()
            agy_win.activate()
        except: pass
    else:
        print("Không tìm thấy cửa sổ IDE đang mở.")
        
    # 3. Mở trình duyệt với Claude
    print("Đang mở trình duyệt truy cập Claude...")
    subprocess.Popen("start https://claude.ai", shell=True)
    time.sleep(4) # Chờ trình duyệt tải
    
    # 4. Thu nhỏ trình duyệt và đưa vào góc trái
    windows = gw.getAllWindows()
    claude_win = None
    for w in windows:
        if 'claude' in w.title.lower():
            claude_win = w
            break
            
    if claude_win:
        print(f"Đã tìm thấy trình duyệt Claude: {claude_win.title}")
        try:
            if claude_win.isMaximized or claude_win.isMinimized:
                claude_win.restore()
                
            screen_w, screen_h = pyautogui.size()
            
            # Thu nhỏ ở góc trên bên trái (rộng 250, cao 300)
            target_w, target_h = 250, 300
            target_x = 10
            target_y = 60 # Hơi thấp xuống 1 tí so với mép trên
            
            claude_win.resizeTo(target_w, target_h)
            claude_win.moveTo(target_x, target_y)
            claude_win.activate()
            print("Đã đặt Claude vào góc trái thành công!")
        except Exception as e:
            print(f"Lỗi khi điều khiển cửa sổ Claude: {e}")
    else:
        print("Không tìm thấy cửa sổ trình duyệt Claude mới mở.")
        
    print("Setup không gian làm việc hoàn tất!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Công cụ ma thuật điều khiển cửa sổ Windows")
    parser.add_argument("--active", action="store_true", help="Chế độ click chọn cửa sổ (đếm ngược 5s)")
    parser.add_argument("--demo", action="store_true", help="Chạy chế độ biểu diễn (mặc định File Explorer)")
    parser.add_argument("--demo2", action="store_true", help="Mở 6 cửa sổ Notepad và xếp thẳng hàng")
    parser.add_argument("--setup", action="store_true", help="Setup không gian làm việc (Antigravity Max, Claude Mini Góc Trái)")
    parser.add_argument("--name", type=str, help="Tên cửa sổ (dùng kết hợp với --demo hoặc chế độ tìm theo tên)", default=None)
    parser.add_argument("-x", type=int, help="Tọa độ X (mặc định 0)", default=0)
    parser.add_argument("-y", type=int, help="Tọa độ Y (mặc định 0)", default=0)
    
    args = parser.parse_args()
    
    if args.demo:
        demo_mode(args.name)
    elif args.demo2:
        demo_mode_2()
    elif args.setup:
        setup_work_mode()
    elif args.active:
        move_active_window(args.x, args.y)
    elif args.name:
        move_window_by_name(args.name, args.x, args.y)
    else:
        # Nếu không truyền tham số nào, mặc định chạy chế độ active
        move_active_window(args.x, args.y)
