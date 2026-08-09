import pyautogui
import time

def main():
    print("Chuẩn bị test cuộn trang...")
    print("Hãy mở sẵn một trang web dài, bạn có 3 giây để chuẩn bị!")
    
    for i in range(3, 0, -1):
        print(f"Đếm ngược: {i}...")
        time.sleep(1)
    
    # Đưa chuột ra giữa màn hình
    screen_width, screen_height = pyautogui.size()
    pyautogui.moveTo(screen_width / 2, screen_height / 2, duration=1.0)
    
    print("Bắt đầu cuộn XUỐNG...")
    for _ in range(5):
        pyautogui.scroll(-500) # Số âm là cuộn xuống
        time.sleep(0.3)
        
    print("Tạm dừng 2 giây...")
    time.sleep(2)
    
    print("Bắt đầu cuộn LÊN...")
    for _ in range(5):
        pyautogui.scroll(500) # Số dương là cuộn lên
        time.sleep(0.3)
        
    print("Hoàn tất diễn xiếc!")

if __name__ == "__main__":
    main()
