"""
tools/clipboard_manager.py — đọc/ghi clipboard hiện tại.

    python tools/clipboard_manager.py --action read
    python tools/clipboard_manager.py --action write --text=<văn bản>
    python tools/clipboard_manager.py --action write --stdin        # văn bản dài / nhạy cảm: KHÔNG qua argv

TL-14: văn bản dài truyền qua stdin (giới hạn dòng lệnh Windows ~32 KB, và argv hiện trong danh sách tiến trình).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_WRITE_CHARS = 1_000_000


def build_parser():
    p = _common.ArgParser(description="Đọc/ghi clipboard")
    p.add_argument("--action", choices=["read", "write"], required=True)
    p.add_argument("--text", type=str, default=None)
    p.add_argument("--stdin", action="store_true")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    pyperclip = _common.require("pyperclip")
    try:
        if a.action == "read":
            content = pyperclip.paste()
            _common.emit(True, text=content or "", empty=not content)
        text = sys.stdin.buffer.read().decode("utf-8", errors="replace") if a.stdin else (a.text or "")
        if not text:
            _common.fail("Thiếu nội dung để ghi vào clipboard.")
        if len(text) > MAX_WRITE_CHARS:
            _common.fail(f"Văn bản quá dài (> {MAX_WRITE_CHARS} ký tự).")
        pyperclip.copy(text)
        _common.emit(True, message=f"Đã chép {len(text)} ký tự vào clipboard.", chars=len(text))
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Lỗi clipboard: {e}")
