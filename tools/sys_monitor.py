"""tools/sys_monitor.py — CPU / RAM / ổ đĩa hệ thống / pin (psutil). Chỉ đọc."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

GB = 1024 ** 3


def collect(psutil):
    drive = (os.environ.get("SystemDrive") or "").strip()
    root = drive + "\\" if drive else os.path.abspath(os.sep)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage(root)
    out = {
        "cpu_percent": psutil.cpu_percent(interval=0.5),
        "cpu_cores": psutil.cpu_count(logical=True),
        "ram_percent": mem.percent,
        "ram_used_gb": round(mem.used / GB, 1),
        "ram_total_gb": round(mem.total / GB, 1),
        "disk_path": root,
        "disk_percent": disk.percent,
        "disk_free_gb": round(disk.free / GB, 1),
        "disk_total_gb": round(disk.total / GB, 1),
        "battery": None,
    }
    try:
        b = psutil.sensors_battery()
    except Exception:
        b = None
    if b is not None:
        out["battery"] = {"percent": round(b.percent), "plugged_in": bool(b.power_plugged),
                          "minutes_left": None if b.secsleft in (-1, -2) else round(b.secsleft / 60)}
    return out


if __name__ == "__main__":
    _common.ensure_utf8()
    ps = _common.require("psutil")
    try:
        _common.emit(True, **collect(ps))
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không đọc được thông số hệ thống: {e}")
