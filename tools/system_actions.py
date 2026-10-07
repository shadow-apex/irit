"""
tools/system_actions.py — đóng / ẩn / thu nhỏ / khôi phục ứng dụng và ghi chú nhanh.

    python tools/system_actions.py close <app> [--force]
    python tools/system_actions.py hide|minimize|restore <app>
    python tools/system_actions.py note --text=<nội dung> [--new]

TL-02: `close` dùng chung validate_process_name + danh sách bảo vệ + đóng êm (xem _procutil).
TL-06: `hide` ghi sổ cửa sổ đã ẩn (hwnd/pid/tiêu đề) ⇒ `restore` khôi phục được cả cửa sổ đã ẩn;
chọn cửa sổ theo tên exe CHÍNH XÁC trước, theo tiêu đề chỉ khi không có kết quả và độ dài ≥ 4;
cửa sổ của chính Iris luôn bị loại; báo số cửa sổ bị tác động.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

LEDGER_NAME = "hidden_windows.json"


# ----------------------------------------------------------------- sổ cửa sổ đã ẩn
def _ledger_path():
    return os.path.join(_common.user_data_dir(), LEDGER_NAME)


def load_ledger(path=None):
    path = path or _ledger_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_ledger(items, path=None):
    path = path or _ledger_path()
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)
    _common.private_chmod(path)


# ----------------------------------------------------------------- hành động
def close_app(target, force=False):
    import _procutil

    res = _procutil.close_processes(target, force=force)
    ok = res.pop("success")
    return ok, res


def minimize_app(target):
    import _winutil

    wins = _winutil.select_windows(_winutil.enum_windows(), target)
    for w in wins:
        _winutil.show_window(w["hwnd"], 6)  # SW_MINIMIZE
    if not wins:
        return False, {"error": f"Không thấy cửa sổ nào khớp '{target}' (cửa sổ của Iris bị loại)."}
    return True, {"message": f"Đã đưa {len(wins)} cửa sổ xuống thanh tác vụ.", "affected": len(wins)}


def hide_app(target):
    import _winutil

    wins = _winutil.select_windows(_winutil.enum_windows(), target)
    if not wins:
        return False, {"error": f"Không thấy cửa sổ nào khớp '{target}' (cửa sổ của Iris bị loại)."}
    ledger = load_ledger()
    known = {e.get("hwnd") for e in ledger}
    for w in wins:
        if w["hwnd"] not in known:
            ledger.append({"hwnd": w["hwnd"], "pid": w["pid"], "title": w["title"], "exe": w["exe"],
                           "hidden_at": time.time()})
        _winutil.show_window(w["hwnd"], 0)  # SW_HIDE
    save_ledger(ledger)
    return True, {"message": f"Đã ẩn {len(wins)} cửa sổ. Dùng restore_app để hiện lại.", "affected": len(wins)}


def restore_app(target):
    import _winutil

    ledger = load_ledger()
    # Chỉ giữ mục còn hợp lệ: cửa sổ còn tồn tại VÀ vẫn thuộc đúng PID đã ghi (tránh HWND tái sử dụng).
    alive = [e for e in ledger if _winutil.is_window(e["hwnd"]) and _winutil.window_pid(e["hwnd"]) == e.get("pid")]
    matched = _winutil.select_windows(alive, target)
    restored = 0
    for e in matched:
        _winutil.show_window(e["hwnd"], 9)  # SW_RESTORE
        _winutil.foreground(e["hwnd"])
        restored += 1
    if matched:
        gone = {e["hwnd"] for e in matched}
        save_ledger([e for e in alive if e["hwnd"] not in gone])
    else:
        save_ledger(alive)
        # Không có trong sổ ⇒ thử cửa sổ đang thu nhỏ/hiển thị.
        for w in _winutil.select_windows(_winutil.enum_windows(), target):
            _winutil.show_window(w["hwnd"], 9)
            _winutil.foreground(w["hwnd"])
            restored += 1
    if restored == 0:
        return False, {"error": f"Không có cửa sổ nào khớp '{target}' để khôi phục (cả trong sổ cửa sổ đã ẩn)."}
    return True, {"message": f"Đã khôi phục {restored} cửa sổ.", "affected": restored}


def write_note(text, new=False):
    import ctypes

    temp_path = os.path.join(tempfile.gettempdir(), "iris_quick_note.txt")
    with open(temp_path, "w" if new else "a", encoding="utf-8") as f:
        f.write("- " + text + "\n")

    import _winutil

    existing = [w for w in _winutil.enum_windows() if "iris_quick_note" in w["title"].lower()]
    if existing:
        hwnd = existing[0]["hwnd"]
        u = ctypes.windll.user32
        from ctypes import wintypes

        u.FindWindowExW.restype = wintypes.HWND
        u.FindWindowExW.argtypes = [wintypes.HWND, wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
        u.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        u.SendMessageW.restype = ctypes.c_ssize_t
        h_edit = u.FindWindowExW(hwnd, None, "Edit", None) or u.FindWindowExW(hwnd, None, "RichEditD2DPT", None)
        if h_edit:
            with open(temp_path, "r", encoding="utf-8") as f:
                full = f.read()
            buf = ctypes.create_unicode_buffer(full)
            u.SendMessageW(h_edit, 0x000C, 0, ctypes.addressof(buf))  # WM_SETTEXT
            u.SendMessageW(h_edit, 0x00B1, len(full), len(full))      # EM_SETSEL
            u.SendMessageW(h_edit, 0x00B7, 0, 0)                       # EM_SCROLLCARET
            _winutil.show_window(hwnd, 9)
            _winutil.foreground(hwnd)
            return True, {"message": "Đã cập nhật cửa sổ Notepad đang mở.", "path": temp_path}
        u.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE — Notepad lạ, mở lại
        time.sleep(0.5)
    subprocess.Popen(["notepad.exe", temp_path])
    return True, {"message": "Đã mở Notepad với ghi chú.", "path": temp_path}


def build_parser():
    p = _common.ArgParser(description="Đóng/ẩn/thu nhỏ/khôi phục ứng dụng, ghi chú")
    sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("close")
    c.add_argument("target")
    c.add_argument("--force", action="store_true")
    for name in ("hide", "minimize", "restore"):
        sp = sub.add_parser(name)
        sp.add_argument("target")
    n = sub.add_parser("note")
    n.add_argument("--text", required=True)
    n.add_argument("--new", action="store_true")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    _common.dpi_aware()
    a = build_parser().parse_args()
    try:
        if a.command == "close":
            _common.require("psutil")
            ok, fields = close_app(a.target, a.force)
        elif a.command == "hide":
            ok, fields = hide_app(a.target)
        elif a.command == "minimize":
            ok, fields = minimize_app(a.target)
        elif a.command == "restore":
            ok, fields = restore_app(a.target)
        else:
            ok, fields = write_note(a.text, a.new)
    except ValueError as e:
        _common.fail(str(e))
    _common.emit(ok, **fields)
