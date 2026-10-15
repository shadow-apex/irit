"""
tools/iris_showcase.py — Trình diễn trực tiếp (Live Showcase) các khả năng của Iris:
1. Tự động mở Notepad và ghi danh sách các tính năng với độ trễ (delay) chân thực.
2. Tăng âm lượng hệ thống (Volume Up).
3. Giảm âm lượng hệ thống (Volume Down).
4. Mở tab mới trên trình duyệt.
5. Đóng tab trình duyệt vừa mở.
6. Di chuyển con trỏ chuột mượt mà trên màn hình.
7. Di chuyển cửa sổ Notepad trên màn hình.
"""
import ctypes
from ctypes import wintypes
import math
import os
import subprocess
import sys
import tempfile
import time
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402
import _winutil  # noqa: E402

VK_VOLUME_DOWN, VK_VOLUME_UP = 0xAE, 0xAF
KEYEVENTF_KEYUP = 2
VK_CONTROL = 0x11
VK_W = 0x57


def _press_key(vk):
    ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def _hotkey(mod_vk, key_vk):
    ctypes.windll.user32.keybd_event(mod_vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(key_vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(key_vk, 0, KEYEVENTF_KEYUP, 0)
    ctypes.windll.user32.keybd_event(mod_vk, 0, KEYEVENTF_KEYUP, 0)


def speak_phrase(text):
    """Phát âm thanh thông báo qua Windows Speech Synthesizer (nếu có)."""
    try:
        ps_code = "[System.Reflection.Assembly]::LoadWithPartialName('System.Speech') | Out-Null; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak($args[0])"
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_code, text],
            timeout=5,
            capture_output=True,
            check=False,
        )
    except Exception:
        pass


def find_notepad_edit(keyword):
    """Tìm HWND của cửa sổ Notepad và control Edit bên trong."""
    user32 = ctypes.windll.user32
    target_hwnd = None
    target_edit = None

    def enum_cb(hwnd, _lparam):
        nonlocal target_hwnd, target_edit
        length = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        if keyword in buf.value or "Notepad" in buf.value:
            target_hwnd = hwnd
            def child_cb(chwnd, _lp):
                nonlocal target_edit
                cname = ctypes.create_unicode_buffer(256)
                user32.GetClassNameW(chwnd, cname, 256)
                if cname.value in ("Edit", "RichEditD2DPT"):
                    target_edit = chwnd
                return True
            cb_child = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(child_cb)
            user32.EnumChildWindows(hwnd, cb_child, 0)
            return False
        return True

    cb_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(enum_cb)
    user32.EnumWindows(cb_t, 0)
    return target_hwnd, target_edit


def update_notepad(h_edit, text_content):
    """Ghi trực tiếp nội dung văn bản vào Notepad qua Win32 API mà không chiếm focus."""
    if not h_edit:
        return
    user32 = ctypes.windll.user32
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    buf = ctypes.create_unicode_buffer(text_content)
    # WM_SETTEXT = 0x000C
    user32.SendMessageW(h_edit, 0x000C, 0, ctypes.addressof(buf))
    # EM_SETSEL (đặt con trỏ về cuối) = 0x00B1
    n_len = len(text_content)
    user32.SendMessageW(h_edit, 0x00B1, n_len, n_len)
    # EM_SCROLLCARET = 0x00B7
    user32.SendMessageW(h_edit, 0x00B7, 0, 0)


def run_showcase():
    temp_dir = tempfile.gettempdir()
    file_name = "iris_live_showcase.txt"
    temp_path = os.path.join(temp_dir, file_name)

    content = (
        "============================================================\n"
        "         IRIS AI ASSISTANT - TRÌNH DIỄN NĂNG LỰC HỆ THỐNG\n"
        "============================================================\n"
        "Xin chào! Sau đây là các tính năng tự động hóa trên máy tính:\n"
    )

    with open(temp_path, "w", encoding="utf-8") as f:
        f.write(content)

    # Khởi động Notepad
    proc = subprocess.Popen(["notepad.exe", temp_path])
    time.sleep(1.2)

    notepad_hwnd, hedit = find_notepad_edit("iris_live_showcase")
    if notepad_hwnd:
        # Căn chỉnh vị trí Notepad ban đầu ở góc trái màn hình
        _winutil.move_resize(notepad_hwnd, 60, 90, 680, 520)

    # -------------------------------------------------------------
    # 1. TĂNG ÂM LƯỢNG
    # -------------------------------------------------------------
    content += "\n[1/6] ĐIỀU KHIỂN ÂM LƯỢNG: Tăng âm lượng hệ thống..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể tăng âm lượng")
    time.sleep(0.4)
    for _ in range(6):
        _press_key(VK_VOLUME_UP)
        time.sleep(0.08)
    time.sleep(1.6)

    # -------------------------------------------------------------
    # 2. GIẢM ÂM LƯỢNG
    # -------------------------------------------------------------
    content += "\n[2/6] ĐIỀU KHIỂN ÂM LƯỢNG: Giảm âm lượng hệ thống..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể giảm âm lượng")
    time.sleep(0.4)
    for _ in range(6):
        _press_key(VK_VOLUME_DOWN)
        time.sleep(0.08)
    time.sleep(1.6)

    # -------------------------------------------------------------
    # 3. MỞ TAB MỚI
    # -------------------------------------------------------------
    content += "\n[3/6] TRÌNH DUYỆT: Tự động mở một tab trình duyệt mới..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể mở tab mới")
    time.sleep(0.4)
    try:
        webbrowser.open_new_tab("https://www.google.com")
    except Exception:
        _hotkey(VK_CONTROL, ord("T"))
    time.sleep(2.5)

    # -------------------------------------------------------------
    # 4. ĐÓNG TAB
    # -------------------------------------------------------------
    content += "\n[4/6] TRÌNH DUYỆT: Tự động đóng tab trình duyệt..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể đóng tab")
    time.sleep(0.4)
    _hotkey(VK_CONTROL, VK_W)
    time.sleep(1.6)

    # -------------------------------------------------------------
    # 5. DI CHUYỂN CON TRỎ CHUỘT
    # -------------------------------------------------------------
    content += "\n[5/6] ĐIỀU KHIỂN CHUỘT: Tự động di chuyển con trỏ chuột trên màn hình..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể di chuyển con trỏ")
    time.sleep(0.4)
    sw = ctypes.windll.user32.GetSystemMetrics(0)
    sh = ctypes.windll.user32.GetSystemMetrics(1)
    cx, cy = sw // 2, sh // 2
    for angle in range(0, 360, 15):
        rad = math.radians(angle)
        x = int(cx + 240 * math.cos(rad))
        y = int(cy + 170 * math.sin(rad))
        ctypes.windll.user32.SetCursorPos(x, y)
        time.sleep(0.02)
    time.sleep(1.5)

    # -------------------------------------------------------------
    # 6. DI CHUYỂN CỬA SỔ
    # -------------------------------------------------------------
    content += "\n[6/6] QUẢN LÝ CỬA SỔ: Di chuyển vị trí cửa sổ Notepad trên màn hình..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể di chuyển cửa sổ")
    time.sleep(0.4)
    if notepad_hwnd:
        # Lượn cửa sổ sang phải rồi quay về
        for step_x in range(60, 620, 35):
            _winutil.move_resize(notepad_hwnd, step_x, 90, 680, 520)
            time.sleep(0.025)
        time.sleep(0.4)
        for step_x in range(620, 240, -35):
            _winutil.move_resize(notepad_hwnd, step_x, 90, 680, 520)
            time.sleep(0.025)
    time.sleep(1.5)

    # -------------------------------------------------------------
    # KẾT THÚC
    # -------------------------------------------------------------
    content += (
        "\n------------------------------------------------------------\n"
        "==> HOÀN TẤT TRÌNH DIỄN! Iris luôn sẵn sàng hỗ trợ bạn.\n"
        "============================================================\n"
    )
    update_notepad(hedit, content)

    # Đảm bảo ghi lại file đầy đủ
    with open(temp_path, "w", encoding="utf-8") as f:
        f.write(content)

    return {
        "success": True,
        "message": (
            "Đã hoàn thành toàn bộ màn trình diễn trực tiếp theo đúng thứ tự: "
            "(1) Tăng âm lượng, (2) Giảm âm lượng, (3) Mở tab, (4) Đóng tab, "
            "(5) Di chuyển con trỏ chuột, (6) Di chuyển cửa sổ Notepad."
        ),
        "steps": [
            "Tăng âm lượng (Volume Up)",
            "Giảm âm lượng (Volume Down)",
            "Mở tab mới (Open Tab)",
            "Đóng tab (Close Tab)",
            "Di chuyển con trỏ chuột (Move Mouse)",
            "Di chuyển cửa sổ (Move Window)",
        ],
    }


def build_parser():
    p = _common.ArgParser(description="Trình diễn trực tiếp các khả năng của Iris")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    _common.dpi_aware()
    build_parser().parse_args()
    try:
        res = run_showcase()
    except Exception as e:
        _common.fail(f"Lỗi khi thực hiện màn trình diễn: {e}")
    ok = res.pop("success", True)
    _common.emit(ok, **res)
