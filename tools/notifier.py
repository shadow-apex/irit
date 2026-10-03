import argparse
from plyer import notification
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def send_toast(title, message):
    """Gửi thông báo hệ thống bằng plyer"""
    try:
        notification.notify(
            title=title,
            message=message,
            app_name='Antigravity AI',
            timeout=10
        )
        print(f"Đã gửi thông báo: '{title} - {message}'")
    except Exception as e:
        print(f"Lỗi khi gửi thông báo: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Công cụ Nhắc nhở & Thông báo (Notifier)")
    parser.add_argument("--title", type=str, required=True, help="Tiêu đề thông báo")
    parser.add_argument("--message", type=str, required=True, help="Nội dung thông báo")
    
    args = parser.parse_args()
    send_toast(args.title, args.message)
