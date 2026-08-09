"""
tools/sys_monitor.py

Bao cao suc khoe he thong: CPU, RAM, dung luong dia, pin.

FIX (2026):
  - Truoc day KHONG co try/except nao, ke ca khong guard import psutil ->
    neu thieu psutil hoac bat ky loi nao (vd khong doc duoc dia), script
    crash voi traceback tho, KHONG in duoc JSON gi ca.
  - Truoc day hardcode 'C:\\' de doc dung luong dia -> sai neu Windows duoc
    cai o o dia khac (vd D:\\). Nay doc dung tu bien moi truong
    SystemDrive (Windows luon dat san bien nay).
"""
import json
import sys
import io
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import psutil
except ImportError:
    print(json.dumps({"success": False, "error": "Thieu thu vien psutil. Chay: pip install -r tools/requirements.txt"}))
    sys.exit(1)


def get_system_health():
    """Lay thong tin phan cung va he thong."""
    health_data = {"success": True}

    # 1. CPU
    health_data["cpu_percent"] = psutil.cpu_percent(interval=1)
    health_data["cpu_cores"] = psutil.cpu_count(logical=False)
    health_data["cpu_threads"] = psutil.cpu_count(logical=True)

    # 2. RAM
    mem = psutil.virtual_memory()
    health_data["ram_total_gb"] = round(mem.total / (1024 ** 3), 2)
    health_data["ram_used_gb"] = round(mem.used / (1024 ** 3), 2)
    health_data["ram_percent"] = mem.percent

    # 3. Dia (o dia he thong — doc tu bien moi truong SystemDrive thay vi
    # hardcode 'C:\\', vi Windows co the duoc cai o o dia khac).
    system_drive = os.environ.get("SystemDrive", "C:") + "\\"
    try:
        disk = psutil.disk_usage(system_drive)
        health_data["disk_total_gb"] = round(disk.total / (1024 ** 3), 2)
        health_data["disk_free_gb"] = round(disk.free / (1024 ** 3), 2)
        health_data["disk_percent"] = disk.percent
    except Exception as e:
        health_data["disk_error"] = str(e)

    # 4. Pin (neu co)
    try:
        battery = psutil.sensors_battery()
    except Exception:
        battery = None
    if battery:
        health_data["battery_percent"] = battery.percent
        health_data["battery_plugged"] = battery.power_plugged
    else:
        health_data["battery_percent"] = "No Battery (Desktop)"
        health_data["battery_plugged"] = True

    return health_data


if __name__ == "__main__":
    try:
        result = get_system_health()
    except Exception as e:
        result = {"success": False, "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)
