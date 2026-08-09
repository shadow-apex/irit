import os
from playwright.sync_api import sync_playwright

SESSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "session.json")

def login():
    with sync_playwright() as p:
        print("Đang khởi động trình duyệt...")
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        
        print("Mở trang Messenger...")
        page.goto("https://www.messenger.com/")
        
        print("\n=================================================================")
        print("BƯỚC 1: VUI LÒNG ĐĂNG NHẬP FACEBOOK TRÊN CỬA SỔ TRÌNH DUYỆT VỪA MỞ!")
        print("Mật khẩu của bạn sẽ hoàn toàn được giữ bí mật, AI không hề biết.")
        print("BƯỚC 2: Sau khi đăng nhập thành công và thấy danh sách chat hiện ra,")
        print("        Hãy quay lại Terminal này và nhấn phím ENTER để Lưu!")
        print("=================================================================\n")
        
        input(">>> BẤM PHÍM ENTER SAU KHI BẠN ĐĂNG NHẬP XONG: ")
        
        # Lưu cookie
        context.storage_state(path=SESSION_FILE)
        print(f"\n[OK] Đã lưu phiên đăng nhập thành công tại: {SESSION_FILE}")
        print("Bây giờ bạn có thể đóng cửa sổ trình duyệt này.")
        print("Từ nay về sau, bạn hãy dùng lệnh 'mess_ngam.py' để nhắn tin tàng hình!")
        browser.close()

if __name__ == "__main__":
    login()
