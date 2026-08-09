"""
tools/clipboard_history.py

Luu lich su NHIEU muc clipboard gan nhat (khac clipboard_manager.py chi
doc/ghi mot muc HIEN TAI). Vi Windows khong bao cho tien trinh biet khi
nao clipboard doi noi dung, tool nay chay mot vong lap NEN (tach tien
trinh, giong kieu --active cua magic_move.py) de poll clipboard moi giay
va ghi vao file lich su moi khi phat hien thay doi.

FIX (2026):
  - Them khoa file cap he dieu hanh (msvcrt) + ghi "atomic" (os.replace)
    quanh moi thao tac doc-sua-ghi HISTORY_PATH — truoc day watch() (ghi
    ngam moi giay) va cac lenh list/use/clear (goi bat cu luc nao) khong
    co khoa nao, co the ghi de mat du lieu cua nhau.
  - use_entry() truoc day khong bat loi pyperclip.copy() (co the nem loi
    khi clipboard dang bi tien trinh khac giu).
  - Them try/except o __main__ (truoc day khong co) de khong crash "cam".

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

try:
    import msvcrt
    _HAS_MSVCRT = True
except ImportError:
    _HAS_MSVCRT = False

HISTORY_PATH = os.path.join(tempfile.gettempdir(), "iris_clipboard_history.json")
HISTORY_LOCK_PATH = os.path.join(tempfile.gettempdir(), "iris_clipboard_history.lock")
PID_PATH = os.path.join(tempfile.gettempdir(), "iris_clipboard_watch.pid")
MAX_ENTRIES = 50


class _HistoryLock:
    """Khoa file cap he dieu hanh: watch() (ghi moi giay khi clipboard doi)
    va cac lenh list/use/clear (goi bat cu luc nao tu Electron) deu doc-sua-
    ghi CHUNG 1 file HISTORY_PATH. Khong co khoa nay, 2 ben co the ghi de
    len nhau (vd 'clear' vua chay xong thi watch() lai ghi lai history cu
    no doc TRUOC luc bi clear)."""

    def __enter__(self):
        if not _HAS_MSVCRT:
            self._f = None
            return self
        self._f = open(HISTORY_LOCK_PATH, "a+b")
        deadline = time.time() + 5
        while True:
            try:
                msvcrt.locking(self._f.fileno(), msvcrt.LK_LOCK, 1)
                return self
            except OSError:
                if time.time() > deadline:
                    self._f.close()
                    raise TimeoutError("Khong lay duoc khoa file lich su clipboard.")
                time.sleep(0.05)

    def __exit__(self, exc_type, exc, tb):
        if self._f is None:
            return
        try:
            self._f.seek(0)
            msvcrt.locking(self._f.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            self._f.close()


def _load_history():
    if not os.path.exists(HISTORY_PATH):
        return []
    try:
        with open(HISTORY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_history(items):
    # Ghi "atomic" (ghi ra file tam roi os.replace) de tranh file JSON bi
    # hong neu tien trinh bi kill giua luc dang ghi.
    tmp_path = HISTORY_PATH + f".tmp{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(items[-MAX_ENTRIES:], f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, HISTORY_PATH)


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
                with _HistoryLock():
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
    with _HistoryLock():
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
    with _HistoryLock():
        history = _load_history()
    if index < 0 or index >= len(history):
        return {"success": False, "error": f"Khong co muc so {index}."}
    text = history[index]["text"]
    try:
        pyperclip.copy(text)
    except Exception as e:
        return {"success": False, "error": f"Khong ghi duoc vao clipboard: {e}"}
    return {"success": True, "message": f"Da dan lai muc {index} vao clipboard.", "text": text[:200]}


def clear_history():
    with _HistoryLock():
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
    try:
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
    except Exception as e:
        # 'watch' chay ngam khong co ai doc stdout nen khong can in gi them;
        # 4 lenh con lai LUON phai tra JSON, khong duoc de traceback tho lot ra.
        if args.command != "watch":
            print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
            sys.exit(1)
