"""
tools/iris_showcase.py — Trình diễn trực tiếp (Live Showcase) các khả năng của Iris.

Iris tự giới thiệu ngắn gọn, rồi lần lượt giới thiệu (bằng giọng nói + ghi vào Notepad) và thực hiện:
  1. Giảm độ sáng             2. Tăng độ sáng
  3. Giảm âm lượng            4. Tăng âm lượng
  5. Mở trình duyệt           6. Đóng trình duyệt
  7. Điều khiển chuột
  8. Phóng to cửa sổ Notepad  9. Thu nhỏ cửa sổ Notepad  10. Di chuyển cửa sổ Notepad

An toàn cho máy người dùng:
 * Độ sáng được đọc trước và luôn được khôi phục về mức ban đầu; màn hình không hỗ trợ chỉnh độ sáng
   qua phần mềm (thường là màn hình rời) thì chỉ giới thiệu, không thao tác.
 * "Đóng trình duyệt" chỉ đóng đúng cửa sổ trình duyệt do Iris vừa mở (so sánh danh sách cửa sổ trước/sau).
   Nếu không nhận ra cửa sổ mới thì chỉ gửi Ctrl+W khi trình duyệt đang là cửa sổ được focus.
 * Con trỏ chuột được trả về vị trí ban đầu sau khi trình diễn.
"""
import ctypes
from ctypes import wintypes
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser

try:
    import asyncio
    import edge_tts
    _HAS_EDGE_TTS = True
except Exception:
    _HAS_EDGE_TTS = False

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402
import _winutil  # noqa: E402
from sys_control import encode_ps  # noqa: E402

TOTAL_STEPS = 10

INTRO_SPEECH = (
    "Xin chào, tôi là Iris, một trợ lý thông minh. "
    "Tôi có thể giúp bạn điều khiển máy tính bằng giọng nói. "
    "Sau đây là một vài ví dụ."
)

NOTEPAD_RECT = (60, 90, 680, 520)  # x, y, rộng, cao — vị trí Notepad lúc bắt đầu

VK_VOLUME_DOWN, VK_VOLUME_UP = 0xAE, 0xAF
KEYEVENTF_KEYUP = 2
VK_CONTROL = 0x11
VK_W = 0x57
WM_CLOSE = 0x0010
SW_MAXIMIZE, SW_MINIMIZE = 3, 6

BROWSER_EXES = frozenset({"chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe"})


def report_step(step_num, title, speech):
    """Báo cáo bước ra stdout để quả cầu năng lượng Iris phát sáng và hiển thị (step 0 = lời giới thiệu)."""
    msg = json.dumps(
        {"step": step_num, "total": TOTAL_STEPS, "title": title, "speech": speech}, ensure_ascii=False
    )
    sys.stdout.write(f"IRIS_SHOWCASE_STEP:{msg}\n")
    sys.stdout.flush()


def _press_key(vk):
    ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def _press_keys(vk, times, delay=0.08):
    for _ in range(times):
        _press_key(vk)
        time.sleep(delay)


def _hotkey(mod_vk, key_vk):
    ctypes.windll.user32.keybd_event(mod_vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(key_vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(key_vk, 0, KEYEVENTF_KEYUP, 0)
    ctypes.windll.user32.keybd_event(mod_vk, 0, KEYEVENTF_KEYUP, 0)


def speak_phrase(text):
    """Phát âm thanh tiếng Việt tự nhiên chuẩn AI (giọng nữ Hoài My Neural giống Iris), fallback sang winsdk/SAPI."""
    # 1. Thử qua Edge-TTS Neural Voice (giọng AI tiếng Việt tự nhiên, ấm áp, truyền cảm giống Iris)
    if _HAS_EDGE_TTS:
        try:
            tmp_mp3 = os.path.join(tempfile.gettempdir(), f"iris_tts_{os.getpid()}_{int(time.time() * 1000)}.mp3")

            async def _edge():
                comm = edge_tts.Communicate(text, "vi-VN-HoaiMyNeural")
                await comm.save(tmp_mp3)

            asyncio.run(_edge())
            if os.path.exists(tmp_mp3) and os.path.getsize(tmp_mp3) > 100:
                winmm = ctypes.windll.winmm
                alias = f"iristts_{os.getpid()}_{int(time.time() * 1000)}"
                try:
                    winmm.mciSendStringW(f'open "{tmp_mp3}" type mpegvideo alias {alias}', None, 0, None)
                    winmm.mciSendStringW(f"play {alias} wait", None, 0, None)
                finally:
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


_showcase_mutex = None


def _acquire_singleton_mutex():
    global _showcase_mutex
    kernel32 = ctypes.windll.kernel32
    # Local\ ensures it is scoped to the current interactive Windows logon session
    _showcase_mutex = kernel32.CreateMutexW(None, False, "Local\\IrisShowcaseLiveSingletonMutex")
    if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        return False
    return True


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
        val = buf.value.lower()
        if keyword.lower() in val:
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


def wait_notepad(keyword, timeout=4.0):
    """Chờ cửa sổ Notepad (và control Edit) xuất hiện thay vì ngủ cố định — máy chậm vẫn bắt được."""
    deadline = time.time() + timeout
    hwnd = edit = None
    while time.time() < deadline:
        hwnd, edit = find_notepad_edit(keyword)
        if hwnd and edit:
            break
        time.sleep(0.2)
    return hwnd, edit


# --------------------------------------------------------------------- độ sáng
_GET_BRIGHTNESS_PS = (
    "$ErrorActionPreference='Stop'; "
    "$b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue "
    "| Select-Object -First 1; "
    "if (-not $b) { exit 3 }; "
    "Write-Output ([int]$b.CurrentBrightness); exit 0"
)
# Mức sáng truyền qua BIẾN MÔI TRƯỜNG (không nội suy vào mã PowerShell) — cùng quy ước với sys_control.py.
_SET_BRIGHTNESS_PS = (
    "$ErrorActionPreference='Stop'; "
    "$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue; "
    "if (-not $m) { exit 3 }; "
    "$m | Invoke-CimMethod -MethodName WmiSetBrightness "
    "-Arguments @{Timeout=1; Brightness=[int]$env:IRIS_BRIGHTNESS} | Out-Null; "
    "exit 0"
)


def brightness_plan(current, drop=30, floor=10):
    """Hàm thuần: (mức thấp, mức cao) để trình diễn giảm rồi tăng độ sáng.

    Giảm tối đa `drop` điểm nhưng không xuống dưới `floor` (tránh màn hình tối đen). Mức "tăng"
    là mức ban đầu; nếu máy vốn đã rất tối (không còn chỗ giảm) thì tăng thêm `drop` điểm để vẫn thấy rõ.
    """
    current = max(0, min(100, int(current)))
    low = max(floor, current - drop)
    high = current if current > low else min(100, low + drop)
    return low, high


def _run_powershell(script, brightness=None):
    env = dict(os.environ)
    if brightness is not None:
        env["IRIS_BRIGHTNESS"] = str(int(brightness))
    return subprocess.run(
        ["powershell", "-NoProfile", "-EncodedCommand", encode_ps(script)],
        capture_output=True,
        env=env,
        timeout=15,
        check=False,
    )


def get_brightness():
    """Độ sáng hiện tại (0–100), hoặc None nếu màn hình không hỗ trợ chỉnh qua phần mềm / đọc lỗi."""
    try:
        r = _run_powershell(_GET_BRIGHTNESS_PS)
        if r.returncode != 0:
            return None
        lines = _common.decode_bytes(r.stdout).strip().splitlines()
        return int(lines[-1]) if lines else None
    except Exception as e:
        sys.stderr.write(f"[brightness get: {e}]\n")
        return None


def set_brightness(level):
    """Đặt độ sáng 0–100. Trả về True/False (không thoát tiến trình như sys_control.py)."""
    try:
        level = max(0, min(100, int(level)))
        return _run_powershell(_SET_BRIGHTNESS_PS, level).returncode == 0
    except Exception as e:
        sys.stderr.write(f"[brightness set: {e}]\n")
        return False


# --------------------------------------------------------------------- trình duyệt
def _browser_hwnds():
    """Tập HWND các cửa sổ trình duyệt đang hiển thị (cần psutil để biết tên exe; thiếu thì rỗng)."""
    try:
        return {
            w["hwnd"]
            for w in _winutil.enum_windows()
            if str(w.get("exe", "")).lower() in BROWSER_EXES
        }
    except Exception as e:
        sys.stderr.write(f"[browser enum: {e}]\n")
        return set()


def open_browser(url="https://www.google.com", wait=2.5):
    """Mở trình duyệt ở cửa sổ mới; trả về danh sách HWND cửa sổ MỚI xuất hiện (có thể rỗng)."""
    before = _browser_hwnds()
    try:
        webbrowser.open_new(url)
    except Exception as e:
        sys.stderr.write(f"[browser open: {e}]\n")
        return []
    deadline = time.time() + wait
    new_windows = []
    while time.time() < deadline:
        time.sleep(0.25)
        new_windows = sorted(_browser_hwnds() - before)
        if new_windows:
            break
    return new_windows


def close_browser(opened):
    """Đóng đúng cửa sổ trình duyệt do Iris vừa mở. Trả về "window" | "tab" | None (không đóng được).

    Không dùng kill tiến trình và không đóng cửa sổ có sẵn của người dùng. Khi không nhận ra cửa sổ mới
    (trình trình duyệt tái dùng cửa sổ cũ để mở tab), chỉ gửi Ctrl+W nếu trình duyệt đang được focus —
    khi đó tab đang hiển thị chính là tab Iris vừa mở.
    """
    closed = 0
    for hwnd in opened:
        if _winutil.is_window(hwnd):
            ctypes.windll.user32.PostMessageW(wintypes.HWND(hwnd), WM_CLOSE, 0, 0)
            closed += 1
    if closed:
        return "window"
    fg = _winutil.foreground_window()
    if fg and str(fg.get("exe", "")).lower() in BROWSER_EXES:
        _hotkey(VK_CONTROL, VK_W)
        return "tab"
    return None


# --------------------------------------------------------------------- chuột
def circle_points(cx, cy, rx, ry, step_deg=15):
    """Hàm thuần: các điểm trên elip tâm (cx, cy), đi đủ một vòng (điểm cuối trùng điểm đầu)."""
    pts = []
    for angle in range(0, 361, step_deg):
        rad = math.radians(angle)
        pts.append((int(cx + rx * math.cos(rad)), int(cy + ry * math.sin(rad))))
    return pts


def _glide(user32, p_from, p_to, steps=12, delay=0.02):
    (x0, y0), (x1, y1) = p_from, p_to
    for i in range(1, steps + 1):
        t = i / steps
        user32.SetCursorPos(int(x0 + (x1 - x0) * t), int(y0 + (y1 - y0) * t))
        time.sleep(delay)


def demo_mouse():
    """Lướt con trỏ ra giữa màn hình, vẽ một vòng elip rồi trả về vị trí ban đầu."""
    u = ctypes.windll.user32
    pt = wintypes.POINT()
    u.GetCursorPos(ctypes.byref(pt))
    origin = (pt.x, pt.y)
    sw, sh = u.GetSystemMetrics(0), u.GetSystemMetrics(1)
    pts = circle_points(sw // 2, sh // 2, min(240, sw // 4), min(170, sh // 4))
    _glide(u, origin, pts[0])
    for x, y in pts[1:]:
        u.SetCursorPos(x, y)
        time.sleep(0.02)
    _glide(u, pts[-1], origin)


# --------------------------------------------------------------------- cửa sổ
def slide_positions(start, end, step):
    """Hàm thuần: các toạ độ x từ `start` tới `end` (gồm cả `end`), mỗi bước |step| điểm ảnh."""
    step = abs(int(step)) or 1
    xs = list(range(start, end, step if start <= end else -step))
    return xs + [end]


def maximize_window(hwnd):
    _winutil.foreground(hwnd)
    _winutil.show_window(hwnd, SW_MAXIMIZE)


def shrink_window(hwnd):
    """Thu nhỏ: hạ cửa sổ về kích thước thường, thu xuống thanh tác vụ, rồi đưa lại về chỗ cũ."""
    x, y, w, h = NOTEPAD_RECT
    _winutil.show_window(hwnd, _winutil.SW_RESTORE)  # hạ từ trạng thái phóng to
    time.sleep(0.6)
    _winutil.move_resize(hwnd, x, y, w, h)
    _winutil.show_window(hwnd, SW_MINIMIZE)  # thu xuống taskbar
    time.sleep(0.9)
    _winutil.show_window(hwnd, _winutil.SW_RESTORE)  # từ taskbar → về lại kích thước thường (không phóng to)
    time.sleep(0.6)
    _winutil.move_resize(hwnd, x, y, w, h)


def move_notepad(hwnd):
    """Di chuyển: lướt cửa sổ sang phải rồi quay về vị trí cũ."""
    x, y, w, h = NOTEPAD_RECT
    _winutil.foreground(hwnd)
    far = x + 560
    for px in slide_positions(x, far, 25) + slide_positions(far, x, 25):
        _winutil.move_resize(hwnd, px, y, w, h)
        time.sleep(0.02)


# --------------------------------------------------------------------- trình diễn
def run_showcase():
    if not _acquire_singleton_mutex():
        sys.stderr.write("[iris_showcase] Đã có một tiến trình trình diễn đang chạy. Hủy bỏ gọi trùng lặp.\n")
        return {
            "success": True,
            "message": "Một phiên trình diễn khác đang diễn ra, tránh chạy trùng lặp.",
            "steps": [],
        }

    warnings = []

    # 1. Báo cáo ngay bước 0 cho quả cầu năng lượng và giao diện sáng lên TỨC THÌ (0ms), không bị khựng
    report_step(0, "Giới thiệu", INTRO_SPEECH)

    # 2. Đọc độ sáng hiện tại trong thread chạy ngầm (PowerShell mất ~1.5s)
    #    Trong lúc Iris đọc lời giới thiệu (mất ~4s), thread này chạy song song nên không gây trễ 1s nào
    brightness_container = [None]

    def _read_brightness_bg():
        brightness_container[0] = get_brightness()

    t_bright = threading.Thread(target=_read_brightness_bg, daemon=True)
    t_bright.start()

    # 3. Đóng cửa sổ Notepad trình diễn cũ nếu còn tồn tại từ phiên trước
    old_hwnd, _ = find_notepad_edit("iris_live_showcase")
    if old_hwnd:
        ctypes.windll.user32.PostMessageW(old_hwnd, WM_CLOSE, 0, 0)

    temp_path = os.path.join(tempfile.gettempdir(), "iris_live_showcase.txt")

    content = (
        "============================================================\n"
        "              IRIS - TRỢ LÝ THÔNG MINH\n"
        "============================================================\n"
        "Tôi là Iris, một trợ lý thông minh.\n"
        "Tôi có thể giúp bạn điều khiển máy tính bằng giọng nói.\n"
        "Sau đây là một vài ví dụ:\n"
    )

    with open(temp_path, "w", encoding="utf-8") as f:
        f.write(content)

    # Khởi động Notepad song song
    subprocess.Popen(["notepad.exe", temp_path])

    # 4. Phát giọng giới thiệu Iris ngay lập tức (không đợi PowerShell độ sáng hay Notepad)
    speak_phrase(INTRO_SPEECH)
    time.sleep(0.3)

    # 5. Căn chỉnh vị trí Notepad ban đầu sau khi nó đã mở trong lúc Iris nói
    notepad_hwnd, hedit = wait_notepad("iris_live_showcase", timeout=3.0)
    if notepad_hwnd:
        _winutil.move_resize(notepad_hwnd, *NOTEPAD_RECT)
        update_notepad(hedit, content)
    else:
        warnings.append("Không tìm thấy cửa sổ Notepad nên bỏ qua phần ghi chú và các thao tác cửa sổ.")

    # 6. Đợi thread đo độ sáng hoàn tất trước khi bước 1 (Giảm độ sáng) bắt đầu
    t_bright.join(timeout=4.0)
    original_brightness = brightness_container[0]
    brightness_ok = original_brightness is not None

    def announce(step_num, title, speech, note):
        """Báo bước cho giao diện, ghi một dòng vào Notepad rồi đọc câu giới thiệu ngắn."""
        nonlocal content
        report_step(step_num, title, speech)
        content += f"\n[{step_num}/{TOTAL_STEPS}] {note}"
        update_notepad(hedit, content)
        speak_phrase(speech)
        time.sleep(0.3)

    current_brightness = original_brightness
    low_level, high_level = brightness_plan(original_brightness) if brightness_ok else (None, None)
    unsupported = "" if brightness_ok else " (màn hình không hỗ trợ, chỉ giới thiệu)"
    if not brightness_ok:
        warnings.append("Màn hình không hỗ trợ chỉnh độ sáng qua phần mềm nên chỉ giới thiệu, không thao tác.")

    try:
        # 1. GIẢM ĐỘ SÁNG
        announce(1, "Giảm độ sáng", "Tôi có thể giảm độ sáng màn hình.", "Giảm độ sáng" + unsupported)
        if brightness_ok:
            if set_brightness(low_level):
                current_brightness = low_level
            else:
                warnings.append("Không giảm được độ sáng.")
            time.sleep(1.0)

        # 2. TĂNG ĐỘ SÁNG
        announce(2, "Tăng độ sáng", "Tôi có thể tăng độ sáng.", "Tăng độ sáng" + unsupported)
        if brightness_ok:
            if set_brightness(high_level):
                current_brightness = high_level
            else:
                warnings.append("Không tăng được độ sáng.")
            time.sleep(0.8)

        # 3. GIẢM ÂM LƯỢNG
        announce(3, "Giảm âm lượng", "Tôi có thể giảm âm lượng.", "Giảm âm lượng")
        _press_keys(VK_VOLUME_DOWN, 6)
        time.sleep(0.8)

        # 4. TĂNG ÂM LƯỢNG
        announce(4, "Tăng âm lượng", "Tôi có thể tăng âm lượng.", "Tăng âm lượng")
        _press_keys(VK_VOLUME_UP, 6)
        time.sleep(0.8)

        # 5. MỞ TRÌNH DUYỆT
        announce(5, "Mở trình duyệt", "Tôi có thể mở trình duyệt.", "Mở trình duyệt")
        opened = open_browser()
        time.sleep(1.2)

        # 6. ĐÓNG TRÌNH DUYỆT (chỉ cửa sổ/tab do Iris vừa mở)
        announce(6, "Đóng trình duyệt", "Tôi có thể đóng trình duyệt.", "Đóng trình duyệt")
        if close_browser(opened) is None:
            warnings.append("Không tự đóng được trình duyệt (không nhận ra cửa sổ do Iris mở) — bạn hãy tự đóng.")
        time.sleep(1.0)

        # 7. ĐIỀU KHIỂN CHUỘT
        announce(7, "Điều khiển chuột", "Tôi có thể điều khiển chuột.", "Điều khiển chuột")
        demo_mouse()
        time.sleep(0.6)

        # 8. PHÓNG TO CỬA SỔ NOTEPAD
        announce(8, "Phóng to cửa sổ", "Tôi có thể phóng to cửa sổ.", "Phóng to cửa sổ Notepad")
        if notepad_hwnd:
            maximize_window(notepad_hwnd)
        time.sleep(1.3)

        # 9. THU NHỎ CỬA SỔ NOTEPAD
        announce(9, "Thu nhỏ cửa sổ", "Tôi có thể thu nhỏ cửa sổ.", "Thu nhỏ cửa sổ Notepad")
        if notepad_hwnd:
            shrink_window(notepad_hwnd)

        # 10. DI CHUYỂN CỬA SỔ NOTEPAD
        announce(10, "Di chuyển cửa sổ", "Tôi có thể di chuyển cửa sổ.", "Di chuyển cửa sổ Notepad")
        if notepad_hwnd:
            move_notepad(notepad_hwnd)
        time.sleep(0.6)
    finally:
        # Luôn trả độ sáng về mức người dùng đang dùng, kể cả khi trình diễn lỗi giữa chừng
        if brightness_ok and current_brightness != original_brightness:
            if not set_brightness(original_brightness):
                sys.stderr.write("[iris_showcase] Không khôi phục được độ sáng ban đầu.\n")

    # -------------------------------------------------------------
    # KẾT THÚC
    # -------------------------------------------------------------
    content += (
        "\n------------------------------------------------------------\n"
        "==> HOÀN TẤT! Iris luôn sẵn sàng hỗ trợ bạn.\n"
        "============================================================\n"
    )
    update_notepad(hedit, content)
    speak_phrase("Đã hoàn tất. Iris luôn sẵn sàng hỗ trợ bạn.")

    # Đảm bảo ghi lại file đầy đủ
    with open(temp_path, "w", encoding="utf-8") as f:
        f.write(content)

    result = {
        "success": True,
        "message": (
            "Iris đã tự giới thiệu và trình diễn theo đúng thứ tự: (1) Giảm độ sáng, (2) Tăng độ sáng, "
            "(3) Giảm âm lượng, (4) Tăng âm lượng, (5) Mở trình duyệt, (6) Đóng trình duyệt, "
            "(7) Điều khiển chuột, (8) Phóng to, (9) Thu nhỏ, (10) Di chuyển cửa sổ Notepad."
        ),
        "steps": [
            "Giảm độ sáng",
            "Tăng độ sáng",
            "Giảm âm lượng (Volume Down)",
            "Tăng âm lượng (Volume Up)",
            "Mở trình duyệt",
            "Đóng trình duyệt",
            "Điều khiển chuột (Move Mouse)",
            "Phóng to cửa sổ Notepad",
            "Thu nhỏ cửa sổ Notepad",
            "Di chuyển cửa sổ Notepad",
        ],
    }
    if warnings:
        result["warnings"] = warnings
    return result


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
