import pyperclip
import argparse
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def read_clipboard():
    """Đọc nội dung hiện tại trong clipboard"""
    content = pyperclip.paste()
    if content:
        print(content)
    else:
        print("[Trống] Bộ nhớ tạm không có văn bản nào.")

def write_clipboard(text):
    """Ghi nội dung vào clipboard"""
    pyperclip.copy(text)
    print(f"Đã lưu thành công đoạn văn bản dài {len(text)} ký tự vào Clipboard!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Công cụ thao túng Clipboard (Bộ nhớ tạm)")
    parser.add_argument("--action", choices=["read", "write"], required=True, help="Hành động (đọc hoặc ghi)")
    parser.add_argument("--text", type=str, help="Văn bản cần ghi vào (chỉ dùng khi action=write)", default="")
    
    args = parser.parse_args()
    
    if args.action == "read":
        read_clipboard()
    elif args.action == "write":
        write_clipboard(args.text)
