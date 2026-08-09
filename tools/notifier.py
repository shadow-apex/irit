"""
tools/notifier.py

Gui thong bao he thong (toast) ngay lap tuc qua plyer.

FIX (2026): ban truoc day bat Exception nhung CHI in() 1 dong text loi va
KHONG sys.exit(1) -> tien trinh luon thoat voi exit code 0 du that bai,
khien Electron (dang dua vao exit code de biet ket qua) LUON bao "thanh
cong" ke ca khi khong gui duoc thong bao nao. Nay in JSON + exit code dung
voi ket qua that.
"""
import argparse
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def send_toast(title, message):
    try:
        from plyer import notification
        notification.notify(title=title, message=message, app_name="Iris AI", timeout=10)
    except Exception as e:
        return {"success": False, "error": str(e)}
    return {"success": True, "message": f"Da gui thong bao: '{title} - {message}'."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cong cu Nhac nho & Thong bao (Notifier)")
    parser.add_argument("--title", type=str, required=True, help="Tieu de thong bao")
    parser.add_argument("--message", type=str, required=True, help="Noi dung thong bao")

    args = parser.parse_args()
    try:
        result = send_toast(args.title, args.message)
    except Exception as e:
        result = {"success": False, "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)
