"""
tools/clipboard_history.py

Luu lich su NHIEU muc clipboard gan nhat (khac clipboard_manager.py chi
doc/ghi mot muc HIEN TAI). Vi Windows khong bao cho tien trinh biet khi
nao clipboard doi noi dung, tool nay chay mot vong lap NEN (tach tien
trinh, giong kieu --active cua magic_move.py) de poll clipboard moi giay
va ghi vao file lich su moi khi phat hien thay doi.

Vi du dung:
    python tools/clipboard_history.py watch           # bat dau chay nen, tu poll & luu
    python tools/clipboard_history.py stop             # dung vong lap nen
    python tools/clipboard_history.py list --limit 10
    python tools/clipboard_history.py use 2             # dan lai muc so 2 vao clipboard
    python tools/clipboard_history.py clear
"""
import sys
import io
import os
import json
import time
import tempfile
import argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import pyperclip
except ImportError:
    print(json.dumps({"success": False, "error": "Thieu thu vien pyperclip. Chay: pip install -r tools/requirements.txt"}))
    sys.exit(1)

HISTORY_PATH = os.path.join(tempfile.gettempdir(), "iris_clipboard_history.json")
PID_PATH = os.path.join(tempfile.gettempdir(), "iris_clipboard_watch.pid")
MAX_ENTRIES = 50


def _load_history():
    if not os.path.exists(HISTORY_PATH):
        return []
    try:
        with open(HISTORY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_history(items):
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(items[-MAX_ENTRIES:], f, ensure_ascii=False, indent=2)


def watch():
    """Vong lap nen: poll clipboard moi giay, ghi khi doi noi dung. Chay
    mai cho den khi bi kill tu lenh 'stop'."""
    with open(PID_PATH, "w") as f:
        f.write(str(os.getpid()))
    last = None
    try:
        while True:
            try:
                current = pyperclip.paste()
            except Exception:
                current = None
            if current and current != last:
                history = _load_history()
                if not history or history[-1].get("text") != current:
                    history.append({"text": current, "ts": time.time()})
                    _save_history(history)
                last = current
            time.sleep(1)
    finally:
        if os.path.exists(PID_PATH):
            try:
                os.remove(PID_PATH)
            except Exception:
                pass


def stop_watch():
    if not os.path.exists(PID_PATH):
        return {"success": False, "error": "Khong thay vong lap nen nao dang chay."}
    with open(PID_PATH, "r") as f:
        pid = int(f.read().strip())
    try:
        import subprocess
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if os.path.exists(PID_PATH):
            try:
                os.remove(PID_PATH)
            except Exception:
                pass
    return {"success": True, "message": "Da dung vong lap theo doi clipboard."}


def list_history(limit=10):
    history = _load_history()
    total = len(history)
    start = max(0, total - limit)
    sliced = history[start:]
    items = [
        {"index": start + i, "text": it["text"][:200], "ts": it["ts"]}
        for i, it in enumerate(sliced)
    ]
    items.reverse()  # moi nhat len dau
    return {"success": True, "count": total, "items": items}


def use_entry(index):
    history = _load_history()
    if index < 0 or index >= len(history):
        return {"success": False, "error": f"Khong co muc so {index}."}
    text = history[index]["text"]
    pyperclip.copy(text)
    return {"success": True, "message": f"Da dan lai muc {index} vao clipboard.", "text": text[:200]}


def clear_history():
    _save_history([])
    return {"success": True, "message": "Da xoa lich su clipboard."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Luu & quan ly lich su clipboard")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("watch", help="Chay vong lap nen theo doi clipboard")
    sub.add_parser("stop", help="Dung vong lap nen")
    p_list = sub.add_parser("list", help="Liet ke lich su")
    p_list.add_argument("--limit", type=int, default=10)
    p_use = sub.add_parser("use", help="Dan lai 1 muc trong lich su vao clipboard")
    p_use.add_argument("index", type=int)
    sub.add_parser("clear", help="Xoa toan bo lich su")

    args = parser.parse_args()
    if args.command == "watch":
        watch()
    elif args.command == "stop":
        print(json.dumps(stop_watch(), ensure_ascii=False))
    elif args.command == "list":
        print(json.dumps(list_history(args.limit), ensure_ascii=False))
    elif args.command == "use":
        print(json.dumps(use_entry(args.index), ensure_ascii=False))
    elif args.command == "clear":
        print(json.dumps(clear_history(), ensure_ascii=False))
