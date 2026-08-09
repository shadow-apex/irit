"""
tools/power_plan.py

Chuyen doi che do nguon (power plan) tren Windows bang powercfg (co san
trong Windows, khong can cai them gi). Dung cac alias GUID mac dinh cua
Windows nen chay dung tren moi may, khong can tu do GUID:
  SCHEME_BALANCED = Can bang (mac dinh)
  SCHEME_MIN      = Tiet kiem pin (Power saver)
  SCHEME_MAX      = Hieu nang cao (High performance)

FIX (2026):
  - subprocess.run(..., text=True) truoc day KHONG chi dinh encoding ->
    dung codepage mac dinh cua console (thuong KHONG phai UTF-8 tren
    Windows). Ten scheme powercfg tra ve co dau tieng Viet ("Cân bằng"...)
    co the gay UnicodeDecodeError va crash script. Nay chi dinh ro
    encoding="utf-8", errors="replace" de khong bao gio crash vi decode.
  - Them try/except o __main__ (truoc day khong co).

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


def _run(args, timeout=10):
    return subprocess.run(
        args, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=timeout,
    )


def get_active_plan():
    result = _run(["powercfg", "/getactivescheme"])
    if result.returncode != 0:
        return {"success": False, "error": result.stderr.strip()}
    return {"success": True, "raw": result.stdout.strip()}


def set_plan(name):
    alias = ALIAS_MAP.get(name)
    if not alias:
        return {"success": False, "error": f"Che do khong hop le: {name}. Chon: balanced, saver, performance."}
    result = _run(["powercfg", "/setactive", alias])
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

    try:
        out = get_active_plan() if args.command == "get" else set_plan(args.name)
    except subprocess.TimeoutExpired:
        out = {"success": False, "error": "Het thoi gian cho powercfg phan hoi."}
    except Exception as e:
        out = {"success": False, "error": str(e)}

    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0 if out.get("success") else 1)
