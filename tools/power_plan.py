"""
tools/power_plan.py

Chuyen doi che do nguon (power plan) tren Windows bang powercfg (co san
trong Windows, khong can cai them gi). Dung cac alias GUID mac dinh cua
Windows nen chay dung tren moi may, khong can tu do GUID:
  SCHEME_BALANCED = Can bang (mac dinh)
  SCHEME_MIN      = Tiet kiem pin (Power saver)
  SCHEME_MAX      = Hieu nang cao (High performance)

Vi du dung:
    python tools/power_plan.py get
    python tools/power_plan.py set balanced
    python tools/power_plan.py set saver
    python tools/power_plan.py set performance
"""
import sys
import io
import json
import argparse
import subprocess

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

ALIAS_MAP = {
    "balanced": "SCHEME_BALANCED",
    "saver": "SCHEME_MIN",
    "performance": "SCHEME_MAX",
}


def get_active_plan():
    result = subprocess.run(["powercfg", "/getactivescheme"], capture_output=True, text=True)
    if result.returncode != 0:
        return {"success": False, "error": result.stderr.strip()}
    return {"success": True, "raw": result.stdout.strip()}


def set_plan(name):
    alias = ALIAS_MAP.get(name)
    if not alias:
        return {"success": False, "error": f"Che do khong hop le: {name}. Chon: balanced, saver, performance."}
    result = subprocess.run(["powercfg", "/setactive", alias], capture_output=True, text=True)
    if result.returncode == 0:
        return {"success": True, "message": f"Da chuyen sang che do '{name}'."}
    return {"success": False, "error": result.stderr.strip() or "Khong the doi che do nguon."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Doi/kiem tra power plan Windows")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("get", help="Xem power plan dang active")
    p_set = sub.add_parser("set", help="Doi power plan")
    p_set.add_argument("name", choices=["balanced", "saver", "performance"])
    args = parser.parse_args()

    if args.command == "get":
        print(json.dumps(get_active_plan(), ensure_ascii=False))
    else:
        print(json.dumps(set_plan(args.name), ensure_ascii=False))
