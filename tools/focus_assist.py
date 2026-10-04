"""
tools/focus_assist.py — mở trang Settings của Focus Assist (ms-settings:quiethours).

Windows KHÔNG có API công khai để bật/tắt Focus Assist âm thầm; tool CHỈ mở trang Settings để người
dùng tự chọn chế độ (không sửa registry nhị phân không công bố).
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

if __name__ == "__main__":
    _common.ensure_utf8()
    try:
        subprocess.run(["cmd", "/c", "start", "", "ms-settings:quiethours"], check=True)
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không mở được Settings: {e}")
    _common.emit(True, message="Đã mở trang cài đặt Focus Assist.",
                 instructions="Không có API chính thức để bật/tắt Focus Assist ngầm — hãy nhờ người dùng chọn chế độ trên màn hình Settings vừa mở.")
