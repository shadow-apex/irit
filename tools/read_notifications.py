"""
tools/read_notifications.py — đọc thông báo toast gần đây của Windows (winsdk).

    python tools/read_notifications.py [--limit N] [--reveal-otp]

TL-08: mã OTP/xác minh được CHE (`****`) trừ khi có --reveal-otp (người dùng yêu cầu rõ). Lưu ý quyền riêng
tư: nội dung thông báo (Zalo/Telegram/mail…) sẽ được gửi lên mô hình đám mây khi Gemini đọc nó ra.
"""
import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_OTP_KEYWORDS = re.compile(
    r"(\botp\b|\bm[ãa]\b|\bcode\b|\bverify\b|verification|passcode|one[- ]time|\bpin\b|"
    r"x[áa]c\s*(th[ựu]c|minh|nh[ậa]n)|m[ậa]t\s*kh[ẩa]u|password)", re.I)
_DIGITS = re.compile(r"(?<!\d)\d{4,8}(?!\d)")


def mask_otp(text):
    """Che dãy 4–8 chữ số khi văn bản có từ khoá kiểu 'mã/code/OTP/verification'."""
    if not text or not _OTP_KEYWORDS.search(text):
        return text
    return _DIGITS.sub("****", text)


def mask_notification_texts(texts, reveal=False):
    if reveal:
        return list(texts)
    joined_has_kw = any(_OTP_KEYWORDS.search(t or "") for t in texts)
    out = []
    for t in texts:
        out.append(_DIGITS.sub("****", t) if (joined_has_kw and t) else t)
    return out


async def get_notifications(limit, reveal):
    import winsdk.windows.ui.notifications.management as n_management
    from winsdk.windows.ui.notifications import KnownNotificationBindings

    listener = n_management.UserNotificationListener.current
    if await listener.request_access_async() != 1:  # 1 = Allowed
        _common.fail("Không có quyền truy cập Notification. Cấp quyền trong Windows Settings → Privacy → Notifications.")
    notifications = await listener.get_notifications_async(1)  # TOAST
    results = []
    for notif in notifications:
        if len(results) >= limit:
            break
        app_info = notif.app_info
        app_name = app_info.display_info.display_name if app_info else "Unknown App"
        binding = notif.notification.visual.get_binding(KnownNotificationBindings.toast_generic)
        texts = [t.text for t in binding.get_text_elements()] if binding else []
        results.append({"id": notif.id, "app": app_name, "content": mask_notification_texts(texts, reveal),
                        "time": str(notif.creation_time)})
    return results


def build_parser():
    p = _common.ArgParser()
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--reveal-otp", action="store_true", dest="reveal_otp")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    _common.require("winsdk")
    try:
        res = asyncio.run(get_notifications(max(1, min(a.limit, 20)), a.reveal_otp))
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        _common.fail(str(e))
    _common.emit(True, notifications=res, otp_masked=not a.reveal_otp,
                 privacy="Nội dung thông báo sẽ được gửi lên mô hình đám mây khi đọc ra.")
