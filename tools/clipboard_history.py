"""
tools/clipboard_history.py — lịch sử clipboard NGẮN HẠN (mặc định TẮT, phải bật có chủ đích).

    python tools/clipboard_history.py start | stop | list [--limit N] | use <index> | clear

TL-08 (quyền riêng tư):
 * Chỉ chạy khi IRIS_CLIPBOARD_HISTORY=1 (Node cũng chặn + hiện chỉ báo).
 * Lưu ở thư mục dữ liệu của Iris (IRIS_USER_DATA), quyền 0600 — không còn %TEMP%.
 * TTL (IRIS_CLIPBOARD_TTL_SECONDS, mặc định 600 s) và tối đa 20 mục; hết hạn là bị xoá.
 * BỎ QUA chuỗi giống mật khẩu / mã OTP / số thẻ (Luhn) — xem looks_sensitive().
 * Một thể hiện duy nhất (file PID lưu {pid, create_time}); `stop` kiểm tra create_time + cmdline
   trước khi kết thúc ⇒ không giết nhầm PID bị tái sử dụng; `stop` xoá luôn lịch sử.
 * Iris tự `stop` khi thoát.
"""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_ENTRIES = 20
DEFAULT_TTL = 600
SCRIPT_NAME = "clipboard_history.py"


# --------------------------------------------------------------------- hàm thuần
def luhn_ok(digits):
    total, alt = 0, False
    for ch in reversed(digits):
        d = ord(ch) - 48
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def looks_sensitive(text):
    """True nếu văn bản giống mật khẩu, mã OTP hoặc số thẻ tín dụng."""
    t = (text or "").strip()
    if not t:
        return False
    compact = re.sub(r"[\s-]", "", t)
    if re.fullmatch(r"\d{4,8}", t):                      # mã OTP / PIN
        return True
    if re.fullmatch(r"\d{13,19}", compact) and luhn_ok(compact):   # số thẻ
        return True
    if re.search(r"\s", t) or not 8 <= len(t) <= 64:
        return False
    if re.match(r"(?i)^(https?://|www\.)", t):
        return False
    classes = sum(bool(re.search(p, t)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
    return classes >= 3                                    # trông như mật khẩu


def prune(items, now, ttl, max_entries=MAX_ENTRIES):
    """Bỏ mục hết hạn, giữ tối đa max_entries mục mới nhất."""
    fresh = [it for it in items if isinstance(it, dict) and now - float(it.get("ts", 0)) <= ttl]
    return fresh[-max_entries:]


def pid_record_matches(rec, proc_create_time, cmdline):
    """Hàm thuần: bản ghi PID có khớp tiến trình thật (create_time ±1 s và cmdline chứa tên script)?"""
    try:
        return abs(float(rec["create_time"]) - float(proc_create_time)) <= 1.0 and \
            any(SCRIPT_NAME in part for part in (cmdline or []))
    except Exception:
        return False


# --------------------------------------------------------------------- lưu trữ
def _paths():
    d = _common.user_data_dir()
    return os.path.join(d, "clipboard_history.json"), os.path.join(d, "clipboard_watch.json")


def _ttl():
    try:
        return max(30, int(os.environ.get("IRIS_CLIPBOARD_TTL_SECONDS", DEFAULT_TTL)))
    except ValueError:
        return DEFAULT_TTL


def _require_enabled():
    if os.environ.get("IRIS_CLIPBOARD_HISTORY") != "1":
        _common.fail("Lịch sử clipboard đang TẮT (riêng tư). Người dùng phải bật bằng IRIS_CLIPBOARD_HISTORY=1 trong .env.")


def _load():
    path = _paths()[0]
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(items):
    path = _paths()[0]
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)
    _common.private_chmod(tmp)
    os.replace(tmp, path)


def _read_pid_record():
    try:
        with open(_paths()[1], "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _running_pid():
    """PID của vòng lặp đang chạy (đã xác minh) hoặc None."""
    rec = _read_pid_record()
    if not rec:
        return None
    try:
        import psutil

        p = psutil.Process(int(rec["pid"]))
        if pid_record_matches(rec, p.create_time(), p.cmdline()):
            return p.pid
    except Exception:
        pass
    return None


# --------------------------------------------------------------------- lệnh
def run_loop():
    """Vòng lặp nền (nội bộ): poll mỗi giây, ghi khi đổi, tự thoát khi file PID bị xoá/đổi."""
    import psutil

    pyperclip = _common.require("pyperclip")
    pid_path = _paths()[1]
    me = psutil.Process(os.getpid())
    with open(pid_path, "w", encoding="utf-8") as f:
        json.dump({"pid": me.pid, "create_time": me.create_time()}, f)
    _common.private_chmod(pid_path)
    last = None
    ttl = _ttl()
    try:
        while True:
            rec = _read_pid_record()
            if not rec or rec.get("pid") != me.pid:
                break  # bị `stop`/thay thế
            try:
                cur = pyperclip.paste()
            except Exception:
                cur = None
            now = time.time()
            if cur and cur != last:
                last = cur
                if not looks_sensitive(cur):
                    hist = prune(_load(), now, ttl)
                    if not hist or hist[-1].get("text") != cur:
                        hist.append({"text": cur, "ts": now})
                        _save(prune(hist, now, ttl))
            else:
                hist = _load()
                kept = prune(hist, now, ttl)
                if len(kept) != len(hist):
                    _save(kept)
            time.sleep(1)
    finally:
        rec = _read_pid_record()
        if rec and rec.get("pid") == me.pid:
            try:
                os.remove(pid_path)
            except OSError:
                pass


def start():
    _require_enabled()
    _common.require("psutil")
    _common.require("pyperclip")
    pid = _running_pid()
    if pid:
        _common.emit(True, message="Đã có vòng lặp theo dõi clipboard đang chạy.", pid=pid, already_running=True)
    kwargs = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
    subprocess.Popen([sys.executable, os.path.abspath(__file__), "_run"], stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)
    for _ in range(20):
        time.sleep(0.25)
        pid = _running_pid()
        if pid:
            _common.emit(True, message=f"Đã bật theo dõi clipboard (giữ {_ttl()} giây, tối đa {MAX_ENTRIES} mục; "
                                       "bỏ qua mật khẩu/OTP/số thẻ).", pid=pid, ttl_seconds=_ttl())
    _common.fail("Không khởi động được vòng lặp theo dõi clipboard.")


def stop():
    pid = _running_pid()
    if not pid:
        try:
            os.remove(_paths()[1])
        except OSError:
            pass
        _save([])
        _common.emit(True, message="Không có vòng lặp nào đang chạy (đã xoá lịch sử).", was_running=False)
    import psutil

    try:
        os.remove(_paths()[1])  # vòng lặp tự thoát khi thấy file PID biến mất
    except OSError:
        pass
    try:
        p = psutil.Process(pid)
        try:
            p.wait(timeout=2.5)
        except psutil.TimeoutExpired:
            p.kill()
    except psutil.NoSuchProcess:
        pass
    _save([])
    _common.emit(True, message="Đã dừng theo dõi clipboard và xoá lịch sử.", was_running=True)


def list_history(limit):
    _require_enabled()
    hist = prune(_load(), time.time(), _ttl())
    total = len(hist)
    start_i = max(0, total - max(1, limit))
    items = [{"index": start_i + i, "text": it["text"][:200], "age_seconds": round(time.time() - it["ts"])}
             for i, it in enumerate(hist[start_i:])]
    items.reverse()
    _common.emit(True, count=total, items=items,
                 privacy="Nội dung này sẽ được gửi lên mô hình đám mây (Gemini) khi bạn đọc nó ra.")


def use_entry(index):
    _require_enabled()
    pyperclip = _common.require("pyperclip")
    hist = prune(_load(), time.time(), _ttl())
    if index < 0 or index >= len(hist):
        _common.fail(f"Không có mục số {index}.")
    pyperclip.copy(hist[index]["text"])
    _common.emit(True, message=f"Đã dán lại mục {index} vào clipboard.", chars=len(hist[index]["text"]))


def build_parser():
    p = _common.ArgParser(description="Lịch sử clipboard ngắn hạn (mặc định tắt)")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("start")
    sub.add_parser("stop")
    sub.add_parser("_run")
    pl = sub.add_parser("list")
    pl.add_argument("--limit", type=int, default=10)
    pu = sub.add_parser("use")
    pu.add_argument("index", type=int)
    sub.add_parser("clear")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    if a.command == "start":
        start()
    elif a.command == "stop":
        stop()
    elif a.command == "_run":
        run_loop()
    elif a.command == "list":
        list_history(a.limit)
    elif a.command == "use":
        use_entry(a.index)
    else:
        _save([])
        _common.emit(True, message="Đã xoá lịch sử clipboard.")
