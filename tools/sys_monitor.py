import psutil
import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def get_system_health():
    """Lấy thông tin phần cứng và hệ thống"""
    health_data = {}
    
    # 1. CPU
    health_data["cpu_percent"] = psutil.cpu_percent(interval=1)
    health_data["cpu_cores"] = psutil.cpu_count(logical=False)
    health_data["cpu_threads"] = psutil.cpu_count(logical=True)
    
    # 2. RAM
    mem = psutil.virtual_memory()
    health_data["ram_total_gb"] = round(mem.total / (1024**3), 2)
    health_data["ram_used_gb"] = round(mem.used / (1024**3), 2)
    health_data["ram_percent"] = mem.percent
    
    # 3. Disk (Ổ đĩa C)
    disk = psutil.disk_usage('C:\\')
    health_data["disk_total_gb"] = round(disk.total / (1024**3), 2)
    health_data["disk_free_gb"] = round(disk.free / (1024**3), 2)
    health_data["disk_percent"] = disk.percent
    
    # 4. Battery (Nếu có)
    battery = psutil.sensors_battery()
    if battery:
        health_data["battery_percent"] = battery.percent
        health_data["battery_plugged"] = battery.power_plugged
    else:
        health_data["battery_percent"] = "No Battery (Desktop)"
        health_data["battery_plugged"] = True

    # In ra dạng JSON để AI dễ phân tích
    print(json.dumps(health_data, indent=4))

if __name__ == "__main__":
    get_system_health()
