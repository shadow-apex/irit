"""
tools/system_ops.py — Tiện ích hệ thống sâu, mạng, cổng (ports), dịch vụ (services) và trình quản lý gói (winget).

    python tools/system_ops.py network
    python tools/system_ops.py ports [--port=8080]
    python tools/system_ops.py ping <host>
    python tools/system_ops.py services [--query="..."] [--action=list|start|stop|restart] [--name="..."]
    python tools/system_ops.py winget --action=search|list|install|upgrade --query="..."
    python tools/system_ops.py clean_temp
    python tools/system_ops.py empty_recycle_bin
    python tools/system_ops.py env_list [--query="..."]

Không dùng os.system, không dùng shell=True, không dùng PowerShell nội suy f-string.
"""
import ctypes
import os
import shutil
import socket
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402


def network_diagnostics():
    psutil = _common.require("psutil")
    hostname = socket.gethostname()
    interfaces = []
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    for iface, addr_list in addrs.items():
        st = stats.get(iface)
        is_up = bool(st.isup) if st else False
        ipv4 = [a.address for a in addr_list if a.family == socket.AF_INET]
        ipv6 = [a.address for a in addr_list if a.family == socket.AF_INET6]
        if ipv4 or is_up:
            interfaces.append({"interface": iface, "up": is_up, "ipv4": ipv4, "ipv6": ipv6[:2]})

    io = psutil.net_io_counters()
    return {
        "action": "network",
        "hostname": hostname,
        "interfaces": interfaces,
        "bytes_sent_mb": round(io.bytes_sent / (1024 * 1024), 2),
        "bytes_recv_mb": round(io.bytes_recv / (1024 * 1024), 2),
        "message": f"Máy '{hostname}' có {len(interfaces)} giao diện mạng đang hoạt động.",
    }


def list_ports(filter_port=None):
    psutil = _common.require("psutil")
    listening = []
    seen = set()
    for conn in psutil.net_connections(kind="inet"):
        if conn.status != "LISTEN" or not conn.laddr:
            continue
        p = int(conn.laddr.port)
        if filter_port and p != int(filter_port):
            continue
        pid = conn.pid or 0
        key = (p, pid)
        if key in seen:
            continue
        seen.add(key)
        proc_name = ""
        if pid:
            try:
                proc_name = psutil.Process(pid).name()
            except Exception:
                pass
        listening.append({"port": p, "ip": conn.laddr.ip, "pid": pid, "process": proc_name})
    listening.sort(key=lambda x: x["port"])
    return {
        "action": "ports",
        "count": len(listening),
        "ports": listening[:100],
        "message": f"Tìm thấy {len(listening)} cổng đang lắng nghe (LISTEN).",
    }


def ping_host(host):
    clean = (host or "").strip()
    if not clean or any(c in clean for c in (" ", ";", "&", "|", "`", "$")):
        _common.fail("Tên miền hoặc địa chỉ IP không hợp lệ.")
    cmd = ["ping", "-n", "3", "-w", "2000", clean] if _common.is_windows() else ["ping", "-c", "3", clean]
    proc = subprocess.run(cmd, capture_output=True, timeout=12)
    out = _common.decode_bytes(proc.stdout).strip()
    return {
        "action": "ping",
        "host": clean,
        "reachable": proc.returncode == 0,
        "output": out[:2000],
        "message": f"Ping tới '{clean}' {'thành công' if proc.returncode == 0 else 'thất bại'}.",
    }


def manage_services(sub_action="list", query="", service_name=""):
    psutil = _common.require("psutil")
    if not _common.is_windows():
        _common.fail("Quản lý Windows Services chỉ hỗ trợ trên Windows.")

    sub = (sub_action or "list").strip().lower()
    if sub == "list":
        q = (query or "").strip().lower()
        items = []
        for s in psutil.win_service_iter():
            try:
                info = s.as_dict()
                if q and q not in info.get("name", "").lower() and q not in info.get("display_name", "").lower():
                    continue
                items.append(
                    {
                        "name": info.get("name"),
                        "display_name": info.get("display_name"),
                        "status": info.get("status"),
                        "start_type": info.get("start_type"),
                    }
                )
            except Exception:
                pass
        return {
            "action": "services",
            "sub_action": "list",
            "count": len(items),
            "services": items[:60],
            "message": f"Tìm thấy {len(items)} dịch vụ khớp yêu cầu.",
        }

    name = (service_name or query or "").strip()
    if not name or any(c in name for c in (";", "&", "|", "`", "$", '"', "'")):
        _common.fail("Tên dịch vụ (service_name) không hợp lệ.")

    if sub in ("start", "stop", "restart"):
        if sub == "restart":
            subprocess.run(["net", "stop", name], capture_output=True, timeout=25)
            proc = subprocess.run(["net", "start", name], capture_output=True, timeout=25)
        else:
            proc = subprocess.run(["net", sub, name], capture_output=True, timeout=25)
        out = (_common.decode_bytes(proc.stdout) + "\n" + _common.decode_bytes(proc.stderr)).strip()
        if proc.returncode != 0:
            _common.fail(f"Không thể {sub} dịch vụ '{name}': {out}")
        return {"action": "services", "sub_action": sub, "service": name, "output": out, "message": f"Đã {sub} dịch vụ '{name}'."}

    _common.fail(f"Hành động dịch vụ không hợp lệ: {sub}")


def run_winget(sub_action="search", query=""):
    winget_bin = shutil.which("winget") or shutil.which("winget.exe")
    if not winget_bin:
        _common.fail("Máy tính chưa có công cụ winget (Windows Package Manager).")

    sub = (sub_action or "search").strip().lower()
    q = (query or "").strip()

    if sub == "search":
        if not q:
            _common.fail("Thiếu từ khoá 'query' để tìm kiếm gói phần mềm trên winget.")
        cmd = [winget_bin, "search", q, "--n", "15", "--accept-source-agreements"]
        timeout_s = 30
    elif sub == "list":
        cmd = [winget_bin, "list"] + ([q] if q else []) + ["--n", "30", "--accept-source-agreements"]
        timeout_s = 30
    elif sub == "install":
        if not q:
            _common.fail("Thiếu tên hoặc ID gói phần mềm cần cài đặt.")
        cmd = [winget_bin, "install", q, "--silent", "--accept-package-agreements", "--accept-source-agreements"]
        timeout_s = 180
    elif sub == "upgrade":
        if not q:
            _common.fail("Thiếu tên hoặc ID gói phần mềm cần cập nhật.")
        cmd = [winget_bin, "upgrade", q, "--silent", "--accept-package-agreements", "--accept-source-agreements"]
        timeout_s = 180
    elif sub == "uninstall":
        if not q:
            _common.fail("Thiếu tên hoặc ID gói phần mềm cần gỡ cài đặt.")
        cmd = [winget_bin, "uninstall", q, "--silent", "--accept-source-agreements"]
        timeout_s = 120
    else:
        _common.fail(f"Hành động winget không hợp lệ: {sub}")

    proc = subprocess.run(cmd, capture_output=True, timeout=timeout_s)
    out = _common.decode_bytes(proc.stdout).strip()
    err = _common.decode_bytes(proc.stderr).strip()
    return {
        "action": "winget",
        "sub_action": sub,
        "query": q,
        "exit_code": proc.returncode,
        "output": out[-6000:] if len(out) > 6000 else out,
        "stderr": err[-2000:] if len(err) > 2000 else err,
        "message": f"Đã chạy winget {sub} cho '{q}' (exit code {proc.returncode}).",
    }


def clean_temp_files():
    temp_dir = tempfile.gettempdir()
    removed_files = 0
    removed_dirs = 0
    freed_bytes = 0
    skipped = 0

    for entry in os.scandir(temp_dir):
        # Không xoá file ghi chú của Iris hoặc lock file
        if entry.name.startswith("iris_"):
            continue
        try:
            if entry.is_file(follow_symlinks=False):
                sz = entry.stat(follow_symlinks=False).st_size
                os.remove(entry.path)
                freed_bytes += sz
                removed_files += 1
            elif entry.is_dir(follow_symlinks=False):
                shutil.rmtree(entry.path, ignore_errors=False)
                removed_dirs += 1
        except Exception:
            skipped += 1

    freed_mb = round(freed_bytes / (1024 * 1024), 2)
    return {
        "action": "clean_temp",
        "temp_dir": temp_dir,
        "removed_files": removed_files,
        "removed_dirs": removed_dirs,
        "skipped_in_use": skipped,
        "freed_mb": freed_mb,
        "message": f"Đã dọn dẹp thư mục tạm: xoá {removed_files} file, {removed_dirs} thư mục (giải phóng ~{freed_mb} MB).",
    }


def empty_recycle_bin():
    if not _common.is_windows():
        _common.fail("Chỉ hỗ trợ dọn Thùng rác trên Windows.")
    # SHEmptyRecycleBinW flags: SHERB_NOCONFIRMATION (1) | SHERB_NOPROGRESSUI (2) | SHERB_NOSOUND (4) = 7
    res = ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, 7)
    # 0 = S_OK, -2147418113 (0x8000FFFF) trên Windows khi thùng rác đã trống sẵn
    return {
        "action": "empty_recycle_bin",
        "code": int(res),
        "message": "Đã dọn sạch Thùng rác (Recycle Bin).",
    }


def list_env(query=""):
    q = (query or "").strip().lower()
    secret_tokens = ("key", "token", "secret", "password", "credential", "auth")
    items = {}
    for k, v in sorted(os.environ.items()):
        if q and q not in k.lower():
            continue
        if any(s in k.lower() for s in secret_tokens):
            items[k] = "****[HIDDEN_SECRET]"
        else:
            items[k] = v[:300]
    return {"action": "env_list", "count": len(items), "variables": items}


def build_parser():
    p = _common.ArgParser(description="Công cụ hệ thống & mạng chuyên sâu.")
    p.add_argument(
        "action",
        choices=["network", "ports", "ping", "services", "winget", "clean_temp", "empty_recycle_bin", "env_list"],
    )
    p.add_argument("--sub-action", default="list", help="Hành động phụ cho services hoặc winget.")
    p.add_argument("--query", default="", help="Từ khoá tìm kiếm, tên host, hoặc tên gói winget.")
    p.add_argument("--port", type=int, default=0, help="Số cổng cần lọc.")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    args = build_parser().parse_args()
    act = args.action
    if act == "network":
        res = network_diagnostics()
    elif act == "ports":
        res = list_ports(args.port if args.port > 0 else None)
    elif act == "ping":
        res = ping_host(args.query)
    elif act == "services":
        res = manage_services(args.sub_action, query=args.query, service_name=args.query)
    elif act == "winget":
        res = run_winget(args.sub_action, query=args.query)
    elif act == "clean_temp":
        res = clean_temp_files()
    elif act == "empty_recycle_bin":
        res = empty_recycle_bin()
    elif act == "env_list":
        res = list_env(args.query)
    else:
        _common.fail(f"Action không hợp lệ: {act}")
    _common.emit(True, **res)
