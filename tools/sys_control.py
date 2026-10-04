"""
tools/sys_control.py — âm lượng, độ sáng, Wi-Fi, Bluetooth, camera.

    python tools/sys_control.py --volume mute|unmute|up|down
    python tools/sys_control.py --volume-level 0..100
    python tools/sys_control.py --brightness 0..100
    python tools/sys_control.py --wifi off | --bluetooth on|off | --camera on|off

TL-12:
 * brightness: kiểm tra màn hình CÓ hỗ trợ WmiMonitorBrightnessMethods (màn hình rời thì không) và
   kiểm mã thoát; mức sáng truyền qua BIẾN MÔI TRƯỜNG, không nội suy vào mã PowerShell.
 * bluetooth/camera: chạy quyền Admin với -Wait + mã thoát ⇒ chỉ báo success khi thật sự thành công;
   mã PowerShell nhúng là HẰNG SỐ (-EncodedCommand), không chứa dữ liệu từ người dùng.
 * volume: có đặt mức TUYỆT ĐỐI (--volume-level) và `unmute` tường minh. Phím `mute` của Windows là
   TOGGLE nên kết quả ghi rõ `toggle: true`.
 * CẢNH BÁO camera off: vô hiệu hoá MỌI thiết bị Camera/Image — gồm cả webcam mà Iris đang dùng.
"""
import base64
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

VK_VOLUME_MUTE, VK_VOLUME_DOWN, VK_VOLUME_UP = 0xAD, 0xAE, 0xAF
KEYEVENTF_KEYUP = 2
STEP_PERCENT = 2  # mỗi lần bấm phím âm lượng của Windows ≈ 2%


def volume_key_plan(level):
    """Hàm thuần: (số lần giảm, số lần tăng) để đưa âm lượng về `level` (0–100) tuyệt đối."""
    level = max(0, min(100, int(level)))
    return 100 // STEP_PERCENT, int(round(level / float(STEP_PERCENT)))


def encode_ps(script):
    """PowerShell -EncodedCommand = base64(UTF-16LE)."""
    return base64.b64encode(script.encode("utf-16-le")).decode("ascii")


_HW_SCRIPTS = {
    ("bluetooth", "off"): "Get-PnpDevice -Class Bluetooth | Disable-PnpDevice -Confirm:$false",
    ("bluetooth", "on"): "Get-PnpDevice -Class Bluetooth | Enable-PnpDevice -Confirm:$false",
    ("camera", "off"): "Get-PnpDevice -Class Camera,Image | Disable-PnpDevice -Confirm:$false",
    ("camera", "on"): "Get-PnpDevice -Class Camera,Image | Enable-PnpDevice -Confirm:$false",
}


def hardware_inner_script(device, state):
    body = _HW_SCRIPTS[(device, state)]
    # Dừng ở lỗi đầu tiên; không có thiết bị nào ⇒ mã 2.
    cls = "Bluetooth" if device == "bluetooth" else "Camera,Image"
    return (f"$ErrorActionPreference='Stop'; $d = Get-PnpDevice -Class {cls}; "
            f"if (-not $d) {{ exit 2 }}; {body}; exit 0")


def _press(vk):
    import ctypes

    ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def set_volume(action, level=None):
    if level is not None:
        downs, ups = volume_key_plan(level)
        for _ in range(downs):
            _press(VK_VOLUME_DOWN)
        for _ in range(ups):
            _press(VK_VOLUME_UP)
        return {"message": f"Đã đặt âm lượng ≈ {max(0, min(100, int(level)))}%."}
    if action == "mute":
        _press(VK_VOLUME_MUTE)
        return {"message": "Đã bấm phím tắt tiếng.", "toggle": True,
                "note": "Phím mute của Windows là TOGGLE: nếu máy đang tắt tiếng thì lệnh này bật lại tiếng."}
    if action == "unmute":
        _press(VK_VOLUME_UP)  # bấm phím âm lượng bất kỳ sẽ bỏ tắt tiếng
        _press(VK_VOLUME_DOWN)
        return {"message": "Đã bỏ tắt tiếng (bấm tăng rồi giảm 1 bước)."}
    key = VK_VOLUME_UP if action == "up" else VK_VOLUME_DOWN
    for _ in range(5):
        _press(key)
    return {"message": f"Đã {'tăng' if action == 'up' else 'giảm'} âm lượng ≈ {5 * STEP_PERCENT}%."}


_BRIGHTNESS_PS = (
    "$ErrorActionPreference='Stop'; "
    "$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue; "
    "if (-not $m) { exit 3 }; "
    "$m | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=[int]$env:IRIS_BRIGHTNESS} | Out-Null; "
    "exit 0"
)


def set_brightness(level):
    level = int(level)
    if not 0 <= level <= 100:
        _common.fail("Độ sáng phải trong khoảng 0–100.")
    env = dict(os.environ, IRIS_BRIGHTNESS=str(level))
    r = subprocess.run(["powershell", "-NoProfile", "-EncodedCommand", encode_ps(_BRIGHTNESS_PS)],
                       capture_output=True, env=env)
    if r.returncode == 3:
        _common.fail("Màn hình này không hỗ trợ chỉnh độ sáng qua phần mềm (thường gặp ở màn hình rời).")
    if r.returncode != 0:
        _common.fail(_common.decode_bytes(r.stderr).strip() or "Chỉnh độ sáng thất bại.")
    return {"message": f"Đã chỉnh độ sáng {level}%."}


def toggle_hardware(device, state):
    if device == "wifi":
        if state == "on":
            _common.fail("Bật Wi-Fi tự động chưa được hỗ trợ — hãy bật bằng tay hoặc dùng wifi_manager connect.")
        r = subprocess.run(["netsh", "wlan", "disconnect"], capture_output=True)
        if r.returncode != 0:
            _common.fail(_common.decode_bytes(r.stderr or r.stdout).strip() or "Không ngắt được Wi-Fi.")
        return {"message": "Đã ngắt kết nối Wi-Fi."}
    inner = encode_ps(hardware_inner_script(device, state))
    outer = ("$p = Start-Process powershell -ArgumentList '-NoProfile','-EncodedCommand','" + inner + "' "
             "-Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode")
    r = subprocess.run(["powershell", "-NoProfile", "-EncodedCommand", encode_ps(outer)], capture_output=True)
    if r.returncode == 2:
        _common.fail(f"Không tìm thấy thiết bị {device} nào để {state}.")
    if r.returncode != 0:
        _common.fail(f"Không {state} được {device}: người dùng từ chối UAC hoặc thiếu quyền. "
                     + _common.decode_bytes(r.stderr).strip()[:200])
    extra = {"warning": "Đã vô hiệu hoá MỌI camera/thiết bị ảnh, kể cả webcam Iris dùng cho hand-control/vision."} \
        if (device == "camera" and state == "off") else {}
    return {"message": f"Đã {state} {device}.", **extra}


def build_parser():
    p = _common.ArgParser(description="Quản lý hệ thống")
    p.add_argument("--volume", choices=["mute", "unmute", "up", "down"])
    p.add_argument("--volume-level", type=int, dest="volume_level")
    p.add_argument("--brightness", type=int)
    p.add_argument("--wifi", choices=["on", "off"])
    p.add_argument("--bluetooth", choices=["on", "off"])
    p.add_argument("--camera", choices=["on", "off"])
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    results = []
    if a.volume_level is not None:
        results.append(set_volume(None, a.volume_level))
    elif a.volume:
        results.append(set_volume(a.volume))
    if a.brightness is not None:
        results.append(set_brightness(a.brightness))
    if a.wifi:
        results.append(toggle_hardware("wifi", a.wifi))
    if a.bluetooth:
        results.append(toggle_hardware("bluetooth", a.bluetooth))
    if a.camera:
        results.append(toggle_hardware("camera", a.camera))
    if not results:
        _common.fail("Chỉ định ít nhất một tuỳ chọn (--volume, --volume-level, --brightness, --wifi, --bluetooth, --camera).")
    merged = {"message": " ".join(r["message"] for r in results)}
    for r in results:
        for k, v in r.items():
            if k != "message":
                merged[k] = v
    _common.emit(True, **merged)
