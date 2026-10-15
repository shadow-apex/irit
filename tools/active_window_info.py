"""
tools/active_window_info.py — thông tin cửa sổ đang focus: tiêu đề, exe, PID, vị trí/kích thước.

CHỈ ĐỌC. Lưu ý quyền riêng tư: tiêu đề và đường dẫn tiến trình được gửi lên mô hình đám mây.
Nếu cửa sổ focus là chính Iris, kết quả có `is_iris: true`.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402


def get_active_window_info():
    import _winutil

    _common.dpi_aware()
    win = _winutil.foreground_window()
    if not win:
        # Fallback: nếu chưa focus cửa sổ nào (ví dụ đang ở desktop), thử lấy cửa sổ hiển thị trên cùng
        windows = _winutil.enum_windows(visible_only=True)
        non_iris = [w for w in windows if not _winutil.is_self_window(w)]
        if non_iris:
            win = non_iris[0]
        elif windows:
            win = windows[0]
        else:
            return None
    exe_path = None
    try:
        import psutil

        exe_path = psutil.Process(win["pid"]).exe()
    except Exception:
        pass
    rect = _winutil.get_rect(win["hwnd"]) or (0, 0, 0, 0)
    return {
        "title": win["title"], "pid": win["pid"], "process_name": win["exe"] or None, "process_path": exe_path,
        "rect": {"left": rect[0], "top": rect[1], "right": rect[0] + rect[2], "bottom": rect[1] + rect[3]},
        "width": rect[2], "height": rect[3], "is_iris": _winutil.is_self_window(win),
    }


if __name__ == "__main__":
    _common.ensure_utf8()
    _common.require("psutil")
    try:
        info = get_active_window_info()
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không đọc được cửa sổ đang focus: {e}")
    if info is None:
        _common.emit(True, title="", pid=0, process_name=None, process_path=None,
                     rect={"left": 0, "top": 0, "right": 0, "bottom": 0},
                     width=0, height=0, is_iris=False,
                     message="Hiện không có cửa sổ ứng dụng nào đang mở hoặc được chọn.")
    else:
        _common.emit(True, **info)
