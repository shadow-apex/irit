"""
tools/power_manager.py — ngủ / tắt máy / khởi động lại.

    python tools/power_manager.py sleep|shutdown|restart

TL-12: chỉ báo `success` khi lệnh thật sự được chấp nhận (mã trả về), không còn `os.system`.
 * sleep dùng powrprof.SetSuspendState(FALSE, FALSE, FALSE) qua ctypes; nếu hibernation đang bật,
   Windows có thể NGỦ ĐÔNG thay vì sleep ⇒ kết quả có `hibernate_enabled` để báo thẳng cho người dùng.
 * shutdown/restart chờ 5 giây (huỷ được bằng `shutdown /a`) thay vì tắt tức thì.
Hành động phía Node đã đi qua xác nhận hai bước.
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

SHUTDOWN_DELAY_SECONDS = 5


def hibernate_enabled():
    """Đọc registry (không phụ thuộc ngôn ngữ). None nếu không đọc được."""
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Power") as k:
            return bool(winreg.QueryValueEx(k, "HibernateEnabled")[0])
    except Exception:
        return None


def build_parser():
    p = _common.ArgParser(description="Quản lý nguồn")
    p.add_argument("action", choices=["sleep", "shutdown", "restart"])
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    if a.action == "sleep":
        import ctypes

        hib = hibernate_enabled()
        ctypes.windll.powrprof.SetSuspendState.restype = ctypes.c_ubyte
        ok = ctypes.windll.powrprof.SetSuspendState(0, 0, 0)
        if not ok:
            _common.fail("SetSuspendState thất bại (máy không hỗ trợ sleep hoặc bị chặn bởi chính sách).")
        _common.emit(True, message="Đã yêu cầu máy ngủ.", hibernate_enabled=hib,
                     note="Hibernation đang bật — Windows có thể ngủ đông thay vì sleep." if hib else None)
    flag = "/s" if a.action == "shutdown" else "/r"
    r = subprocess.run(["shutdown", flag, "/t", str(SHUTDOWN_DELAY_SECONDS)], capture_output=True)
    if r.returncode != 0:
        _common.fail(_common.decode_bytes(r.stderr or r.stdout).strip() or "Lệnh shutdown thất bại.")
    _common.emit(True, message=f"Máy sẽ {'tắt' if a.action == 'shutdown' else 'khởi động lại'} sau "
                 f"{SHUTDOWN_DELAY_SECONDS} giây (huỷ bằng lệnh `shutdown /a`).")
