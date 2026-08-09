import sys
import os
import argparse
from playwright.sync_api import sync_playwright, TimeoutError

SESSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "session.json")

def send_message_headless(user_id, message, auto_send=False):
    if not os.path.exists(SESSION_FILE):
        print("LỖI: Chưa có phiên đăng nhập! Vui lòng chạy lệnh: python tools\\mess_login.py trước.")
        sys.exit(1)
        
    with sync_playwright() as p:
        print("Đang khởi động trình duyệt TÀNG HÌNH (Headless)...")
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state=SESSION_FILE)
        page = context.new_page()
        
        url = f"https://www.messenger.com/t/{user_id}"
        print(f"Đang âm thầm truy cập đoạn chat của {user_id}...")
        page.goto(url)
        
        # Xử lý nút "Tiếp tục" (Mã hóa đầu cuối) nếu có
        try:
            continue_btn = page.locator('div[role="button"]:has-text("Tiếp tục")').first
            continue_btn.wait_for(timeout=3000)
            if continue_btn.is_visible():
                print("Đang bấm nút 'Tiếp tục' ngầm...")
                continue_btn.click()
                page.wait_for_timeout(3000) # Đợi trang load lại
        except TimeoutError:
            pass # Không có nút này
            
        print("Đang tìm khung chat...")
        try:
            # Facebook Messenger chat box thường có role=textbox
            chat_box = page.locator('div[role="textbox"]').last
            chat_box.wait_for(timeout=10000)
            chat_box.click()
            print(f"Đang điền tin nhắn: {message}...")
            page.keyboard.type(message)
            
            if auto_send:
                print("Đang bấm Gửi...")
                page.keyboard.press("Enter")
                # Đợi một chút để tin nhắn bay đi trước khi đóng trình duyệt
                page.wait_for_timeout(2000)
                print(">>> ĐÃ GỬI THÀNH CÔNG! <<<")
            else:
                print("\n-------------------------------------------------")
                print("Đã soạn tin nhắn trong thế giới ngầm.")
                print("Vì bạn chưa bật chế độ tự gửi (--send) nên tin nhắn chưa được gửi.")
                print("Tuy nhiên, vì chạy ở chế độ Tàng Hình, bạn sẽ không nhìn thấy nó.")
                print("Nếu bạn muốn nó thực sự gửi đi, hãy thêm cờ --send.")
                print("-------------------------------------------------\n")
                
        except Exception as e:
            print(f"Lỗi khi tìm khung chat: {e}")
            print("Có thể tài khoản của bạn đã bị đăng xuất hoặc Facebook vừa đổi giao diện.")
            
        finally:
            browser.close()
            print("Đã đóng trình duyệt tàng hình.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tool gửi tin nhắn Messenger CHẠY NGẦM")
    parser.add_argument("id", help="ID Facebook của người nhận")
    parser.add_argument("message", help="Nội dung tin nhắn muốn gửi")
    parser.add_argument("--send", action="store_true", help="Cho phép tự động gửi tin nhắn")
    
    # Sửa lỗi hiển thị tiếng Việt trên Terminal
    sys.stdout.reconfigure(encoding='utf-8')
    
    args = parser.parse_args()
    send_message_headless(args.id, args.message, args.send)
