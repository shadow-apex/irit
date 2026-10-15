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
import json
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

def report_step(step_num, title, speech):
    """Báo cáo bước ra stdout để quả cầu năng lượng Iris phát sáng và hiển thị."""
    msg = json.dumps({"step": step_num, "title": title, "speech": speech}, ensure_ascii=False)
    sys.stdout.write(f"IRIS_SHOWCASE_STEP:{msg}\n")
    sys.stdout.flush()

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
    """Phát âm thanh tiếng Việt tự nhiên chuẩn AI (giọng nữ Hoài My Neural giống Iris), fallback sang winsdk/SAPI."""
    # 1. Thử qua Edge-TTS Neural Voice (giọng AI tiếng Việt tự nhiên, ấm áp, truyền cảm giống Iris)
    try:
        import asyncio
        import edge_tts
        import tempfile

        tmp_mp3 = os.path.join(tempfile.gettempdir(), f"iris_tts_{os.getpid()}.mp3")

        async def _edge():
            comm = edge_tts.Communicate(text, "vi-VN-HoaiMyNeural")
            await comm.save(tmp_mp3)

        asyncio.run(_edge())
        if os.path.exists(tmp_mp3) and os.path.getsize(tmp_mp3) > 100:
            winmm = ctypes.windll.winmm
            alias = f"iristts_{os.getpid()}"
            winmm.mciSendStringW(f'open "{tmp_mp3}" type mpegvideo alias {alias}', None, 0, None)
            winmm.mciSendStringW(f"play {alias} wait", None, 0, None)
            winmm.mciSendStringW(f"close {alias}", None, 0, None)
            try:
                os.remove(tmp_mp3)
            except Exception:
                pass
            return
    except Exception as e:
        sys.stderr.write(f"[TTS edge: {e}]\n")

    # 2. Fallback qua winsdk (Microsoft An)
    try:
        import winsdk.windows.media.speechsynthesis as ws
        import winsdk.windows.storage.streams as streams
        import winsound
        import asyncio

        async def _synth():
            synth = ws.SpeechSynthesizer()
            for v in ws.SpeechSynthesizer.all_voices:
                if "vi-vn" in v.language.lower() or "an" in v.display_name.lower():
                    synth.voice = v
                    break
            stream = await synth.synthesize_text_to_stream_async(text)
            reader = streams.DataReader(stream.get_input_stream_at(0))
            await reader.load_async(stream.size)
            data = bytearray(stream.size)
            reader.read_bytes(data)
            return bytes(data)

        wav_bytes = asyncio.run(_synth())
        winsound.PlaySound(wav_bytes, winsound.SND_MEMORY)
        return
    except Exception as e:
        sys.stderr.write(f"[TTS winsdk: {e}]\n")

    # 3. Fallback qua PowerShell SAPI (truyền text qua STDIN UTF-8 an toàn)
    try:
        ps_code = (
            "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; "
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$text = [Console]::In.ReadToEnd(); "
            "if ($text) { $s.Speak($text) }"
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_code],
            input=text,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=8,
            check=False,
        )
    except Exception as e:
        sys.stderr.write(f"[TTS fallback: {e}]\n")


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
    report_step(1, "Tăng âm lượng", "Tôi có thể tăng âm lượng")
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
    report_step(2, "Giảm âm lượng", "Tôi có thể giảm âm lượng")
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
    report_step(3, "Mở tab", "Tôi có thể mở tab mới")
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
    report_step(4, "Đóng tab", "Tôi có thể đóng tab")
    content += "\n[4/6] TRÌNH DUYỆT: Tự động đóng tab trình duyệt..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể đóng tab")
    time.sleep(0.4)
    _hotkey(VK_CONTROL, VK_W)
    time.sleep(1.6)

    # -------------------------------------------------------------
    # 5. DI CHUYỂN CON TRỎ CHUỘT
    # -------------------------------------------------------------
    report_step(5, "Di chuyển con trỏ chuột", "Tôi có thể di chuyển con trỏ chuột")
    content += "\n[5/6] ĐIỀU KHIỂN CHUỘT: Tự động di chuyển con trỏ chuột trên màn hình..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể di chuyển con trỏ chuột")
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
    report_step(6, "Di chuyển cửa sổ", "Tôi có thể di chuyển cửa sổ ứng dụng")
    content += "\n[6/6] QUẢN LÝ CỬA SỔ: Di chuyển vị trí cửa sổ Notepad trên màn hình..."
    update_notepad(hedit, content)
    speak_phrase("Tôi có thể di chuyển cửa sổ ứng dụng")
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
    speak_phrase("Đã hoàn tất toàn bộ màn trình diễn trực tiếp.")

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
