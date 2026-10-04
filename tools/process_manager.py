"""
tools/process_manager.py — xem tiến trình đang chạy (top CPU/RAM) và đóng tiến trình theo tên.

    python tools/process_manager.py list [--sort cpu|ram] [--top N]
    python tools/process_manager.py kill chrome.exe [--force]

TL-02: tên được kiểm tra nghiêm ngặt (từ chối * ? / \\ :, danh sách bảo vệ gồm hệ điều hành và
chính Iris), mặc định ĐÓNG ÊM; chỉ dùng /F khi --force (đã qua xác nhận hai bước phía Node).
"""
import sys
import time

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import _common  # noqa: E402


def list_processes(sort_by="ram", top=10):
    psutil = _common.require("psutil")
    # cpu_percent() lần đầu luôn 0.0 ⇒ "mồi" trước, chờ ngắn, rồi đọc lại.
    for p in psutil.process_iter():
        try:
            p.cpu_percent(None)
        except Exception:
            pass
    time.sleep(0.3)
    procs = []
    for p in psutil.process_iter(["pid", "name"]):
        try:
            procs.append({
                "pid": p.pid,
                "name": p.info.get("name") or "?",
                "cpu_percent": round(p.cpu_percent(None), 1),
                "ram_mb": round(p.memory_info().rss / (1024 ** 2), 1),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    key = "cpu_percent" if sort_by == "cpu" else "ram_mb"
    procs.sort(key=lambda x: x[key], reverse=True)
    return {"processes": procs[: max(1, min(top, 100))]}


def build_parser():
    parser = _common.ArgParser(description="Quản lý tiến trình đang chạy")
    sub = parser.add_subparsers(dest="command", required=True)
    p_list = sub.add_parser("list")
    p_list.add_argument("--sort", choices=["cpu", "ram"], default="ram")
    p_list.add_argument("--top", type=int, default=10)
    p_kill = sub.add_parser("kill")
    p_kill.add_argument("name", type=str)
    p_kill.add_argument("--force", action="store_true")
    return parser


if __name__ == "__main__":
    _common.ensure_utf8()
    args = build_parser().parse_args()
    if args.command == "list":
        _common.emit(True, **list_processes(args.sort, args.top))
    else:
        _common.require("psutil")
        import _procutil

        try:
            res = _procutil.close_processes(args.name, force=args.force)
        except ValueError as e:
            _common.fail(str(e))
        ok = res.pop("success")
        _common.emit(ok, **res)
