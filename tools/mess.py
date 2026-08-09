import sys
import time
import argparse
import webbrowser
import pyautogui
import pyperclip

def send_message(user_id, message, auto_send=False):
    url = f"https://www.messenger.com/t/{user_id}"
    print(f"Đang mở đoạn chat với ID: {user_id}...")
    
    # Mở trình duyệt mặc định
    webbrowser.open(url)
    
    # Đợi 5 giây để trình duyệt tải xong trang ban đầu
    print("Đợi 5 giây để tải trang Messenger...")
    for i in range(5, 0, -1):
        print(f"{i}...")
        time.sleep(1)
        
    screen_width, screen_height = pyautogui.size()
    center_x = screen_width / 2 + 100 # Dịch nhẹ sang phải để tránh sidebar
    
    # BƯỚC 1: Xử lý vụ mã hóa đầu cuối (Nút "Tiếp tục" màu xanh)
    print("Đang xử lý nút 'Tiếp tục' (nếu có)...")
    pyautogui.click(center_x, screen_height - 150) # Click vào vị trí nút Tiếp tục
    pyautogui.click(center_x, screen_height - 180) # Click dự phòng cao hơn chút
    
    # BƯỚC 2: Đợi 4 giây lỡ nó chuyển sang trang mã hóa (e2ee)
    print("Đợi 4 giây cho trang chat tải lại (nếu có)...")
    time.sleep(4)
    
    # BƯỚC 3: Click vào khung chat (chữ Aa)
    print("Đang focus vào khung chat...")
    pyautogui.click(center_x, screen_height - 120) 
    time.sleep(0.5)
    
    # Copy tin nhắn vào clipboard để dán (tránh lỗi font tiếng Việt)
    pyperclip.copy(message)
    print("Đang dán tin nhắn vào khung chat...")
    
    # Dán tin nhắn
    pyautogui.hotkey('ctrl', 'v')
    time.sleep(0.5)
    
    if auto_send:
        print("Đang tự động bấm Gửi...")
        pyautogui.press('enter')
        print("Hoàn tất! Tin nhắn đã được gửi.")
    else:
        print("\n==============================================")
        print("Đã soạn xong tin nhắn vào khung chat!")
        print("TUYỆT ĐỐI KHÔNG TỰ GỬI theo yêu cầu an toàn.")
        print("Bạn có thể tự kiểm tra và bấm Enter để gửi.")
        print("==============================================\n")
        print("Mẹo: Nếu muốn tool tự bấm gửi luôn, hãy thêm cờ --send vào cuối lệnh.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tool tự động soạn tin nhắn Messenger")
    parser.add_argument("id", help="ID Facebook của người nhận")
    parser.add_argument("message", help="Nội dung tin nhắn muốn gửi")
    parser.add_argument("--send", action="store_true", help="Cho phép tự động bấm Enter để gửi")
    
    # Xử lý lỗi tiếng Việt trên console
    sys.stdout.reconfigure(encoding='utf-8')
    
    args = parser.parse_args()
    send_message(args.id, args.message, args.send)
