"""
tools/process_manager.py

Quan ly tien trinh dang chay: liet ke top CPU/RAM, hoac ket thuc (kill)
mot tien trinh theo ten. Dung psutil (da co san trong requirements.txt).

Bo sung cho system_actions.py (chi dong 1 app theo ten cua so, khong cho
xem truoc danh sach dang chay/tai nguyen) — tool nay them buoc "xem truoc
roi moi quyet dinh kill".

Vi du dung:
    python tools/process_manager.py list                    # top 10 theo RAM
    python tools/process_manager.py list --sort cpu --top 5
    python tools/process_manager.py kill chrome.exe
"""
import sys
import io
import json
import time
import argparse
import subprocess

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import psutil
except ImportError:
    print(json.dumps({"success": False, "error": "Thieu thu vien psutil. Chay: pip install -r tools/requirements.txt"}))
    sys.exit(1)


def list_processes(sort_by="ram", top=10):
    # Lay cpu_percent() lan dau luon tra ve 0.0 (theo tai lieu psutil) nen
    # can "moi" no truoc, cho mot khoang ngan, roi doc lai de co so lieu that.
    for p in psutil.process_iter():
        try:
            p.cpu_percent(None)
        except Exception:
            pass
    time.sleep(0.3)

    procs = []
    for p in psutil.process_iter(["pid", "name"]):
        try:
            mem_mb = p.memory_info().rss / (1024 ** 2)
            cpu = p.cpu_percent(None)
            procs.append({
                "pid": p.pid,
                "name": p.info.get("name") or "?",
                "cpu_percent": round(cpu, 1),
                "ram_mb": round(mem_mb, 1),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    key = "cpu_percent" if sort_by == "cpu" else "ram_mb"
    procs.sort(key=lambda x: x[key], reverse=True)
    return {"success": True, "processes": procs[:top]}


def kill_process(name):
    if not name.lower().endswith(".exe"):
        name += ".exe"
    result = subprocess.run(["taskkill", "/IM", name, "/F"], capture_output=True, text=True)
    if result.returncode == 0:
        return {"success": True, "message": f"Da ket thuc {name}."}
    return {"success": False, "error": result.stderr.strip() or f"Khong the ket thuc {name} (co the tien trinh khong ton tai)."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Quan ly tien trinh dang chay")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="Liet ke tien trinh dang chay")
    p_list.add_argument("--sort", choices=["cpu", "ram"], default="ram")
    p_list.add_argument("--top", type=int, default=10)

    p_kill = sub.add_parser("kill", help="Ket thuc tien trinh theo ten")
    p_kill.add_argument("name", type=str, help="Ten file .exe, vd chrome.exe")

    args = parser.parse_args()
    if args.command == "list":
        print(json.dumps(list_processes(args.sort, args.top), ensure_ascii=False))
    elif args.command == "kill":
        print(json.dumps(kill_process(args.name), ensure_ascii=False))
