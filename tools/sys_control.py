import argparse
import subprocess
import ctypes
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Constants for Volume Control
VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF

def set_volume(action):
    """Điều khiển âm lượng qua phím ảo"""
    print(f"Thực hiện lệnh âm thanh: {action}")
    if action == "mute":
        ctypes.windll.user32.keybd_event(VK_VOLUME_MUTE, 0, 0, 0)
        ctypes.windll.user32.keybd_event(VK_VOLUME_MUTE, 0, 2, 0)
    elif action == "up":
        # Tăng 10 mức (mỗi lần bấm tăng 2%)
        for _ in range(5):
            ctypes.windll.user32.keybd_event(VK_VOLUME_UP, 0, 0, 0)
            ctypes.windll.user32.keybd_event(VK_VOLUME_UP, 0, 2, 0)
    elif action == "down":
        for _ in range(5):
            ctypes.windll.user32.keybd_event(VK_VOLUME_DOWN, 0, 0, 0)
            ctypes.windll.user32.keybd_event(VK_VOLUME_DOWN, 0, 2, 0)

def set_brightness(level):
    """Chỉnh độ sáng (0-100) qua WMI"""
    print(f"Đang chỉnh độ sáng màn hình xuống {level}%...")
    ps_cmd = f"(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, {level})"
    subprocess.run(["powershell", "-Command", ps_cmd])

def toggle_hardware(device, state):
    """Bật/Tắt phần cứng (Yêu cầu Admin qua UAC prompt)"""
    print(f"Đang yêu cầu quyền Quản trị (Admin) để {state} {device}...")
    print("VUI LÒNG BẤM 'YES' TRÊN MÀN HÌNH ĐỂ CHO PHÉP!")
    
    if device == "wifi":
        if state == "off":
            print("Đang ngắt kết nối mạng Wi-Fi hiện tại...")
            subprocess.run(["netsh", "wlan", "disconnect"])
            print("Đã ngắt kết nối Wi-Fi thành công!")
            return
        else:
            print("Lệnh bật Wi-Fi tự động yêu cầu bạn phải tự connect bằng tay dưới góc phải màn hình, hoặc cung cấp tên mạng (SSID).")
            return
            
    elif device == "bluetooth":
        if state == "off":
            ps_cmd = 'Get-PnpDevice -Class Bluetooth | Disable-PnpDevice -Confirm:$false'
        else:
            ps_cmd = 'Get-PnpDevice -Class Bluetooth | Enable-PnpDevice -Confirm:$false'
            
    elif device == "camera":
        if state == "off":
            ps_cmd = 'Get-PnpDevice -Class Camera,Image | Disable-PnpDevice -Confirm:$false'
        else:
            ps_cmd = 'Get-PnpDevice -Class Camera,Image | Enable-PnpDevice -Confirm:$false'
            
    # Chạy script PowerShell dưới quyền Admin
    try:
        result = subprocess.run([
            "powershell",
            "Start-Process", "powershell",
            "-ArgumentList", f"'-NoProfile -Command {ps_cmd}'",
            "-Verb", "RunAs",
            "-WindowStyle", "Hidden"
        ], capture_output=True, text=True)
        
        if "The request is not supported" in result.stderr:
            print(f"\n❌ [LỖI QUYỀN HẠN] Hệ thống không thể hiển thị bảng xác nhận quyền Quản trị viên (UAC) khi chạy ngầm.")
            print(f"👉 Vui lòng mở Terminal/PowerShell của bạn và dán lệnh sau để tự chạy:")
            print(f"   python tools/sys_control.py --{device} {state}")
            return
            
        print(f"Đã gửi lệnh {state} {device}. Chờ hệ thống thực thi xong.")
    except Exception as e:
        print(f"Lỗi: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Công cụ Quản lý Hệ thống (System Control)")
    parser.add_argument("--volume", choices=["mute", "up", "down"], help="Điều khiển âm lượng")
    parser.add_argument("--brightness", type=int, help="Mức độ sáng (0-100)")
    parser.add_argument("--wifi", choices=["on", "off"], help="Bật/Tắt Wi-Fi")
    parser.add_argument("--bluetooth", choices=["on", "off"], help="Bật/Tắt Bluetooth")
    parser.add_argument("--camera", choices=["on", "off"], help="Bật/Tắt Camera")
    
    args = parser.parse_args()
    
    if args.volume:
        set_volume(args.volume)
    if args.brightness is not None:
        set_brightness(args.brightness)
    if args.wifi:
        toggle_hardware("wifi", args.wifi)
    if args.bluetooth:
        toggle_hardware("bluetooth", args.bluetooth)
    if args.camera:
        toggle_hardware("camera", args.camera)
