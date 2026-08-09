"""
tools/wifi_manager.py

Quan ly Wi-Fi tren Windows qua netsh (co san trong Windows, khong can cai
them gi). Bo sung cho phan bat/tat Wi-Fi da co san trong sys_control.py
bang kha nang: liet ke mang Wi-Fi quet duoc, xem profile da luu, va TU KET
NOI vao 1 SSID da co profile luu san (SSID da tung ket noi va tick "Connect
automatically" truoc do, hoac da duoc them bang 'netsh wlan add profile').

LUU Y BAO MAT: tool nay KHONG nhan hay luu mat khau Wi-Fi qua tham so dong
lenh — mat khau truyen qua argv se bi lo trong danh sach tien trinh/log he
thong. Vi vay 'connect' chi hoat dong voi SSID DA CO SAN profile tren may;
neu la mang moi chua tung ket noi, hay ket noi thu cong 1 lan dau (nhap
mat khau qua UI Windows) roi cac lan sau tool nay moi tu ket noi lai duoc.

Vi du dung:
    python tools/wifi_manager.py list                # cac mang Wi-Fi quet duoc
    python tools/wifi_manager.py profiles              # cac profile da luu tren may
    python tools/wifi_manager.py connect "TenWifi"     # ket noi (can da co profile luu san)
    python tools/wifi_manager.py disconnect
    python tools/wifi_manager.py status
"""
import sys
import io
import re
import json
import argparse
import subprocess

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def _run(args):
    return subprocess.run(["netsh"] + args, capture_output=True, text=True, encoding="utf-8", errors="replace")


def list_networks():
    result = _run(["wlan", "show", "networks", "mode=bssid"])
    if result.returncode != 0:
        return {"success": False, "error": result.stderr.strip() or "Khong the quet mang Wi-Fi. Kiem tra adapter Wi-Fi da bat chua."}
    networks = []
    current = None
    for line in result.stdout.splitlines():
        m = re.match(r"^SSID \d+ : (.*)$", line.strip())
        if m:
            if current:
                networks.append(current)
            current = {"ssid": m.group(1), "signal": None, "auth": None}
            continue
        if current:
            m2 = re.match(r"^Signal\s*:\s*(.*)$", line.strip())
            if m2:
                current["signal"] = m2.group(1)
            m3 = re.match(r"^Authentication\s*:\s*(.*)$", line.strip())
            if m3:
                current["auth"] = m3.group(1)
    if current:
        networks.append(current)
    return {"success": True, "networks": networks}


def list_profiles():
    result = _run(["wlan", "show", "profiles"])
    if result.returncode != 0:
        return {"success": False, "error": result.stderr.strip()}
    profiles = re.findall(r"All User Profile\s*:\s*(.+)", result.stdout)
    return {"success": True, "profiles": [p.strip() for p in profiles]}


def connect(ssid):
    result = _run(["wlan", "connect", f"name={ssid}"])
    if result.returncode == 0 and "completed successfully" in result.stdout.lower():
        return {"success": True, "message": f"Da ket noi toi '{ssid}'."}
    return {
        "success": False,
        "error": (result.stdout.strip() or result.stderr.strip() or f"Khong the ket noi toi '{ssid}'.")
        + " (Luu y: SSID phai da co profile luu san tren may.)",
    }


def disconnect():
    result = _run(["wlan", "disconnect"])
    if result.returncode == 0:
        return {"success": True, "message": "Da ngat ket noi Wi-Fi."}
    return {"success": False, "error": result.stderr.strip()}


def status():
    result = _run(["wlan", "show", "interfaces"])
    if result.returncode != 0:
        return {"success": False, "error": result.stderr.strip()}
    info = {}
    for line in result.stdout.splitlines():
        if ":" in line:
            k, _, v = line.strip().partition(":")
            k, v = k.strip(), v.strip()
            if k and v:
                info[k] = v
    return {"success": True, "status": info}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Quan ly Wi-Fi qua netsh")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="Quet cac mang Wi-Fi xung quanh")
    sub.add_parser("profiles", help="Liet ke profile Wi-Fi da luu tren may")
    p_connect = sub.add_parser("connect", help="Ket noi vao 1 SSID da co profile luu san")
    p_connect.add_argument("ssid", type=str)
    sub.add_parser("disconnect", help="Ngat ket noi Wi-Fi hien tai")
    sub.add_parser("status", help="Xem trang thai ket noi Wi-Fi hien tai")

    args = parser.parse_args()
    if args.command == "list":
        print(json.dumps(list_networks(), ensure_ascii=False))
    elif args.command == "profiles":
        print(json.dumps(list_profiles(), ensure_ascii=False))
    elif args.command == "connect":
        print(json.dumps(connect(args.ssid), ensure_ascii=False))
    elif args.command == "disconnect":
        print(json.dumps(disconnect(), ensure_ascii=False))
    elif args.command == "status":
        print(json.dumps(status(), ensure_ascii=False))
