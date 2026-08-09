"""
tools/clipboard_manager.py

Doc/ghi NOI DUNG HIEN TAI cua clipboard (khac clipboard_history.py luu
NHIEU muc lich su).

FIX (2026): truoc day KHONG co try/except nao ca. pyperclip.paste()/copy()
tren Windows co the nem loi (vd PyperclipWindowsException) khi mot tien
trinh khac dang "giu" clipboard (rat hay gap khi co app chup man hinh,
remote desktop, hoac app quan ly clipboard khac dang chay) -> truoc day
se crash voi traceback tho va khong in duoc gi ca. Nay bat loi va in ra 1
thong bao ro rang, dong thoi tra ve exit code dung voi ket qua.
"""
import pyperclip
import argparse
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def read_clipboard():
    """Doc noi dung hien tai trong clipboard. Tra ve True/False bao ket qua."""
    try:
        content = pyperclip.paste()
    except Exception as e:
        print(f"[Loi] Khong doc duoc clipboard: {e}", file=sys.stderr)
        return False
    if content:
        print(content)
    else:
        print("[Trong] Bo nho tam khong co van ban nao.")
    return True


def write_clipboard(text):
    """Ghi noi dung vao clipboard. Tra ve True/False bao ket qua."""
    try:
        pyperclip.copy(text)
    except Exception as e:
        print(f"[Loi] Khong ghi duoc vao clipboard: {e}", file=sys.stderr)
        return False
    print(f"Da luu thanh cong doan van ban dai {len(text)} ky tu vao Clipboard!")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cong cu thao tac Clipboard (Bo nho tam)")
    parser.add_argument("--action", choices=["read", "write"], required=True, help="Hanh dong (doc hoac ghi)")
    parser.add_argument("--text", type=str, help="Van ban can ghi vao (chi dung khi action=write)", default="")

    args = parser.parse_args()

    ok = read_clipboard() if args.action == "read" else write_clipboard(args.text)
    sys.exit(0 if ok else 1)
