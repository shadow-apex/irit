"""
tools/search_everything.py — tìm file nhanh bằng Everything CLI (es.exe).

    python tools/search_everything.py "<từ khoá>" [--max N]

TL-10: đọc stdout dạng BYTES, giải mã UTF-8 → OEM (đường dẫn có dấu tiếng Việt không còn vỡ);
từ chối truy vấn bắt đầu bằng '-' hoặc '/' (es.exe sẽ hiểu là cờ). Lưu ý quyền riêng tư: đường dẫn
file được gửi lên mô hình đám mây.
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_RESULTS = 100


def validate_query(q):
    if not isinstance(q, str) or not q.strip():
        raise ValueError("Truy vấn rỗng.")
    s = q.strip()
    if s[0] in "-/":
        raise ValueError("Truy vấn không được bắt đầu bằng '-' hoặc '/' (es.exe sẽ hiểu là cờ lệnh).")
    if len(s) > 200 or any(ord(c) < 32 for c in s):
        raise ValueError("Truy vấn quá dài hoặc chứa ký tự điều khiển.")
    return s


def parse_results(raw_bytes):
    text = _common.decode_bytes(raw_bytes)
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def build_parser():
    p = _common.ArgParser(description="Tìm file bằng Everything (es.exe)")
    p.add_argument("query")
    p.add_argument("--max", type=int, default=10)
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    try:
        q = validate_query(a.query)
    except ValueError as e:
        _common.fail(str(e))
    n = max(1, min(a.max, MAX_RESULTS))
    try:
        r = subprocess.run(["es.exe", "-n", str(n), q], capture_output=True, check=False)
    except FileNotFoundError:
        _common.fail("Không tìm thấy 'es.exe'. Tải Everything CLI từ voidtools.com và thêm vào PATH.")
    except Exception as e:  # noqa: BLE001
        _common.fail(str(e))
    if r.returncode != 0:
        _common.fail((_common.decode_bytes(r.stderr) or "es.exe lỗi — Everything đã chạy chưa?").strip())
    _common.emit(True, query=q, results=parse_results(r.stdout))
