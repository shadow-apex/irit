"""tools/notifier.py — gửi thông báo hệ thống ngay lập tức (winsdk / plyer). Lỗi được báo thật, không nuốt."""
import html
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402


def build_parser():
    p = _common.ArgParser(description="Gửi thông báo hệ thống")
    p.add_argument("--title", required=True)
    p.add_argument("--message", required=True)
    return p


def send_notification(title, message):
    # Ưu tiên Windows Toast native qua winsdk (đẹp, không lỗi luồng balloon_tip trên Windows 10/11)
    try:
        import winsdk.windows.ui.notifications as notif
        import winsdk.windows.data.xml.dom as dom

        xml = dom.XmlDocument()
        safe_title = html.escape(title[:120])
        safe_msg = html.escape(message[:1000])
        xml.load_xml(f"<toast><visual><binding template='ToastGeneric'><text>{safe_title}</text><text>{safe_msg}</text></binding></visual></toast>")
        toast = notif.ToastNotification(xml)
        try:
            notif.ToastNotificationManager.create_toast_notifier("Iris").show(toast)
        except Exception:
            notif.ToastNotificationManager.create_toast_notifier(sys.executable).show(toast)
        return
    except Exception:
        pass

    # Dự phòng qua plyer
    plyer = _common.require("plyer")
    plyer.notification.notify(title=title[:120], message=message[:1000], app_name="Iris", timeout=10)


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    try:
        send_notification(a.title, a.message)
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không gửi được thông báo: {e}")
    _common.emit(True, message=f"Đã gửi thông báo: {a.title}")
