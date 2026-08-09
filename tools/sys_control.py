"""
tools/sys_control.py

Dieu khien am luong (phim ao), do sang man hinh (WMI), va bat/tat
wifi/bluetooth/camera (can quyen Admin qua UAC).

FIX (2026):
  - Truoc day file chi in() text thuong, KHONG try/except o __main__, va
    toggle_hardware() luon exit code 0 du that bai -> ben goi (Electron)
    khong bao gio biet duoc thao tac that su thanh cong hay khong. Nay moi
    ham tra ve dict + __main__ in DUNG 1 dong JSON, exit code phan anh
    dung ket qua.
  - subprocess.run(..., text=True) khong chi dinh encoding se dung codepage
    mac dinh cua console (khong phai UTF-8) -> co the UnicodeDecodeError
    tren Windows tieng Viet khi output/loi co dau. Nay dung
    encoding="utf-8", errors="replace" cho moi subprocess.
  - Kiem tra thanh cong/that bai truoc day dua vao chuoi tieng Anh co dinh
    ("The request is not supported") -> sai tren he thong khong phai tieng
    Anh. Nay uu tien dung returncode, chi dung chuoi do lam thong tin bo
    sung (best-effort).
  - --brightness gio duoc gioi han (clamp) trong khoang 0-100.

Vi du dung:
    python tools/sys_control.py --volume up
    python tools/sys_control.py --brightness 50
    python tools/sys_control.py --wifi off
    python tools/sys_control.py --bluetooth on
"""
import argparse
import subprocess
import ctypes
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF


def _run(args, timeout=15):
    return subprocess.run(
        args, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=timeout,
    )


def set_volume(action):
    try:
        if action == "mute":
            ctypes.windll.user32.keybd_event(VK_VOLUME_MUTE, 0, 0, 0)
            ctypes.windll.user32.keybd_event(VK_VOLUME_MUTE, 0, 2, 0)
        elif action == "up":
            for _ in range(5):
                ctypes.windll.user32.keybd_event(VK_VOLUME_UP, 0, 0, 0)
                ctypes.windll.user32.keybd_event(VK_VOLUME_UP, 0, 2, 0)
        elif action == "down":
            for _ in range(5):
                ctypes.windll.user32.keybd_event(VK_VOLUME_DOWN, 0, 0, 0)
                ctypes.windll.user32.keybd_event(VK_VOLUME_DOWN, 0, 2, 0)
        else:
            return {"success": False, "error": f"Hanh dong am luong khong hop le: {action}."}
    except Exception as e:
        return {"success": False, "error": str(e)}
    return {"success": True, "message": f"Da thuc hien lenh am thanh: {action}."}


def set_brightness(level):
    level = max(0, min(100, int(level)))
    ps_cmd = f"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, {level})"
    try:
        result = _run(["powershell", "-NoProfile", "-Command", ps_cmd])
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Het thoi gian cho khi chinh do sang."}
    if result.returncode != 0:
        return {
            "success": False,
            "error": (result.stderr or "").strip()
            or "Khong the chinh do sang (may co the khong ho tro dieu chinh do sang qua WMI, "
               "vd man hinh ngoai/desktop).",
        }
    return {"success": True, "message": f"Da chinh do sang xuong {level}%.", "level": level}


def toggle_hardware(device, state):
    if device == "wifi":
        if state == "off":
            try:
                result = _run(["netsh", "wlan", "disconnect"])
            except subprocess.TimeoutExpired:
                return {"success": False, "error": "Het thoi gian cho khi ngat Wi-Fi."}
            if result.returncode != 0:
                return {"success": False, "error": (result.stderr or "").strip() or "Khong the ngat Wi-Fi."}
            return {
                "success": True,
                "message": "Da ngat ket noi Wi-Fi hien tai (luu y: day chi la NGAT KET NOI, khong tat adapter Wi-Fi).",
            }
        return {
            "success": False,
            "error": "Khong the tu dong BAT lai Wi-Fi tu day — hay ket noi thu cong o goc phai man hinh, "
                     "hoac dung wifi_manager.py de ket noi lai vao 1 SSID da co profile luu san.",
        }

    if device == "bluetooth":
        ps_cmd = (
            "Get-PnpDevice -Class Bluetooth | Disable-PnpDevice -Confirm:$false"
            if state == "off"
            else "Get-PnpDevice -Class Bluetooth | Enable-PnpDevice -Confirm:$false"
        )
    elif device == "camera":
        ps_cmd = (
            "Get-PnpDevice -Class Camera,Image | Disable-PnpDevice -Confirm:$false"
            if state == "off"
            else "Get-PnpDevice -Class Camera,Image | Enable-PnpDevice -Confirm:$false"
        )
    else:
        return {"success": False, "error": f"Thiet bi khong ho tro: {device}."}

    try:
        result = _run([
            "powershell", "-NoProfile", "-Command",
            f"Start-Process powershell -ArgumentList '-NoProfile -Command {ps_cmd}' -Verb RunAs -WindowStyle Hidden",
        ], timeout=20)
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"Het thoi gian cho khi {state} {device}."}
    except Exception as e:
        return {"success": False, "error": str(e)}

    if result.returncode != 0:
        stderr_lower = (result.stderr or "").lower()
        if "not supported" in stderr_lower or "khong duoc ho tro" in stderr_lower:
            return {
                "success": False,
                "error": (
                    f"He thong khong the hien bang xac nhan quyen Quan tri (UAC) khi chay ngam. "
                    f"Hay tu mo Terminal/PowerShell va chay: python tools/sys_control.py --{device} {state}"
                ),
            }
        return {"success": False, "error": (result.stderr or "").strip() or f"Khong the {state} {device}."}

    return {
        "success": True,
        "message": f"Da gui lenh {state} {device}. Neu co hop thoai UAC hien ra, hay bam 'Yes' de xac nhan.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cong cu Quan ly He thong (System Control)")
    parser.add_argument("--volume", choices=["mute", "up", "down"], help="Dieu khien am luong")
    parser.add_argument("--brightness", type=int, help="Muc do sang (0-100)")
    parser.add_argument("--wifi", choices=["on", "off"], help="Bat/Tat Wi-Fi")
    parser.add_argument("--bluetooth", choices=["on", "off"], help="Bat/Tat Bluetooth")
    parser.add_argument("--camera", choices=["on", "off"], help="Bat/Tat Camera")

    args = parser.parse_args()

    results = {}
    overall_ok = True
    try:
        if args.volume:
            results["volume"] = set_volume(args.volume)
        if args.brightness is not None:
            results["brightness"] = set_brightness(args.brightness)
        if args.wifi:
            results["wifi"] = toggle_hardware("wifi", args.wifi)
        if args.bluetooth:
            results["bluetooth"] = toggle_hardware("bluetooth", args.bluetooth)
        if args.camera:
            results["camera"] = toggle_hardware("camera", args.camera)

        if not results:
            print(json.dumps({"success": False, "error": "Khong co tham so nao duoc chi dinh (--volume/--brightness/--wifi/--bluetooth/--camera)."}, ensure_ascii=False))
            sys.exit(1)

        overall_ok = all(r.get("success") for r in results.values())
        print(json.dumps({"success": overall_ok, "results": results}, ensure_ascii=False))
        sys.exit(0 if overall_ok else 1)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
