"""tools/notifier.py — gửi thông báo hệ thống ngay lập tức (plyer). Lỗi được báo thật, không nuốt."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402


def build_parser():
    p = _common.ArgParser(description="Gửi thông báo hệ thống")
    p.add_argument("--title", required=True)
    p.add_argument("--message", required=True)
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    plyer = _common.require("plyer")
    try:
        plyer.notification.notify(title=a.title[:120], message=a.message[:1000], app_name="Iris", timeout=10)
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không gửi được thông báo: {e}")
    _common.emit(True, message=f"Đã gửi thông báo: {a.title}")
