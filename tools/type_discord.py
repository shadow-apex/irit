import pygetwindow as gw
import pyautogui
import pyperclip
import time
import sys

def main():
    # Tìm cửa sổ Discord
    discord_windows = [w for w in gw.getAllWindows() if 'discord' in w.title.lower()]
    if not discord_windows:
        print("Không tìm thấy cửa sổ Discord nào đang mở!")
        return

    win = discord_windows[0]
    print(f"Đã tìm thấy: {win.title}")
    
    # Phóng to nếu đang thu nhỏ và kích hoạt cửa sổ
    if win.isMinimized:
        win.restore()
    try:
        win.activate()
    except Exception:
        pass
        
    # Chờ 1 giây để cửa sổ hiện lên hoàn toàn
    time.sleep(1) 
    
    # Bấm chuột vào khu vực khung chat (thường nằm ở giữa, gần dưới cùng)
    center_x = win.left + (win.width // 2)
    bottom_y = win.top + win.height - 50 
    
    pyautogui.click(center_x, bottom_y)
    time.sleep(0.5)
    
    # Copy nội dung và Paste để không bị lỗi tiếng Việt
    pyperclip.copy("hanh đẹp trai")
    pyautogui.hotkey('ctrl', 'v')
    
    # TUYỆT ĐỐI KHÔNG BẤM ENTER
    print("Đã gõ chữ thành công nhưng không gửi!")

if __name__ == "__main__":
    main()
