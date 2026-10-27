"""tools/sys_monitor.py — CPU / RAM / ổ đĩa hệ thống / pin / tiến trình top / uptime (psutil). Chỉ đọc."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

GB = 1024 ** 3
MB = 1024 ** 2


def collect(psutil, fast=False):
    drive = (os.environ.get("SystemDrive") or "").strip()
    root = drive + "\\" if drive else os.path.abspath(os.sep)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage(root)
    cpu_interval = 0.05 if fast else 0.25
    out = {
        "cpu_percent": psutil.cpu_percent(interval=cpu_interval),
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
        out["battery"] = {
            "percent": round(b.percent),
            "plugged_in": bool(b.power_plugged),
            "minutes_left": None if b.secsleft in (-1, -2) else round(b.secsleft / 60),
        }

    # Thông tin mở rộng cấp Enterprise: Uptime, tất cả phân vùng ổ cứng, Top 5 tiến trình ngốn RAM & Network I/O
    try:
        boot_ts = psutil.boot_time()
        if boot_ts:
            out["uptime_hours"] = round(max(0.0, time.time() - float(boot_ts)) / 3600.0, 1)
    except Exception:
        pass

    try:
        disks = []
        for part in psutil.disk_partitions(all=False):
            if "cdrom" in (part.opts or "").lower() or not part.fstype:
                continue
            try:
                du = psutil.disk_usage(part.mountpoint)
                disks.append(
                    {
                        "drive": part.mountpoint,
                        "percent": du.percent,
                        "free_gb": round(du.free / GB, 1),
                        "total_gb": round(du.total / GB, 1),
                    }
                )
            except Exception:
                continue
        if disks:
            out["disks"] = disks
    except Exception:
        pass

    try:
        procs = []
        for p in psutil.process_iter(["pid", "name", "memory_info"]):
            try:
                mi = p.info.get("memory_info")
                rss_mb = round((mi.rss if mi else 0) / MB, 1)
                if rss_mb >= 20:
                    procs.append(
                        {
                            "pid": p.info.get("pid") or p.pid,
                            "name": p.info.get("name") or "?",
                            "ram_mb": rss_mb,
                        }
                    )
            except Exception:
                continue
        procs.sort(key=lambda x: x["ram_mb"], reverse=True)
        out["top_processes"] = procs[:5]
    except Exception:
        pass

    return out


if __name__ == "__main__":
    _common.ensure_utf8()
    ps = _common.require("psutil")
    try:
        _common.emit(True, **collect(ps))
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không đọc được thông số hệ thống: {e}")
