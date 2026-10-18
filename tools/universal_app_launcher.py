"""
tools/universal_app_launcher.py — Tìm và mở BẤT KỲ ứng dụng nào trên Windows.

    python tools/universal_app_launcher.py launch <query> [--args="..."]
    python tools/universal_app_launcher.py search <query> [--limit=15]
    python tools/universal_app_launcher.py list [--limit=50]

Tìm kiếm đa tầng (không dùng shell=True, không dùng os.system):
1. Alias thông minh (phổ biến trên Windows: settings, calculator, word, excel, 파워포인트, zalo, telegram, chrome, edge, vscode, cmd, powershell, terminal, paint, snipping, registry, services, device manager, control panel...)
2. Start Menu & Desktop Shortcuts (.lnk, .url, .exe) trong:
   - %APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs
   - %PROGRAMDATA%\\Microsoft\\Windows\\Start Menu\\Programs
   - Desktop (User, OneDrive, Public)
3. Windows Registry App Paths:
   - HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths
   - HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths
4. Thư mục cài đặt phổ biến:
   - %LOCALAPPDATA%\\Programs
   - %PROGRAMFILES%, %PROGRAMFILES(X86)% (quét nhanh cấp 1-2)
5. Biến môi trường PATH (shutil.which)
6. Ứng dụng UWP / Microsoft Store qua Get-StartApps (PowerShell -NoProfile -NonInteractive với đối số tĩnh an toàn)
"""
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

# Bảng ánh xạ nhanh cho tên gọi tiếng Việt / tiếng Anh phổ biến -> executable hoặc URI hoặc tên tìm kiếm
SMART_ALIASES = {
    "calc": ("exe", "calc.exe"),
    "calculator": ("exe", "calc.exe"),
    "may tinh": ("exe", "calc.exe"),
    "máy tính": ("exe", "calc.exe"),
    "notepad": ("exe", "notepad.exe"),
    "ghi chu": ("exe", "notepad.exe"),
    "paint": ("exe", "mspaint.exe"),
    "mspaint": ("exe", "mspaint.exe"),
    "cmd": ("exe", "cmd.exe"),
    "command prompt": ("exe", "cmd.exe"),
    "powershell": ("exe", "powershell.exe"),
    "terminal": ("exe", "wt.exe"),
    "windows terminal": ("exe", "wt.exe"),
    "explorer": ("exe", "explorer.exe"),
    "file explorer": ("exe", "explorer.exe"),
    "task manager": ("exe", "taskmgr.exe"),
    "taskmgr": ("exe", "taskmgr.exe"),
    "quan ly tac vu": ("exe", "taskmgr.exe"),
    "control panel": ("exe", "control.exe"),
    "control": ("exe", "control.exe"),
    "regedit": ("exe", "regedit.exe"),
    "registry": ("exe", "regedit.exe"),
    "snipping tool": ("exe", "snippingtool.exe"),
    "snippingtool": ("exe", "snippingtool.exe"),
    "settings": ("uri", "ms-settings:"),
    "windows settings": ("uri", "ms-settings:"),
    "cai dat": ("uri", "ms-settings:"),
    "cài đặt": ("uri", "ms-settings:"),
    "wifi settings": ("uri", "ms-settings:network-wifi"),
    "bluetooth settings": ("uri", "ms-settings:bluetooth"),
    "sound settings": ("uri", "ms-settings:sound"),
    "display settings": ("uri", "ms-settings:display"),
    "windows update": ("uri", "ms-settings:windowsupdate"),
    "store": ("uri", "ms-windows-store:"),
    "microsoft store": ("uri", "ms-windows-store:"),
    "device manager": ("msc", "devmgmt.msc"),
    "services": ("msc", "services.msc"),
    "disk management": ("msc", "diskmgmt.msc"),
    "event viewer": ("msc", "eventvwr.msc"),
    "vscode": ("search", "Visual Studio Code"),
    "visual studio code": ("search", "Visual Studio Code"),
    "code": ("search", "Visual Studio Code"),
    "chrome": ("search", "Google Chrome"),
    "google chrome": ("search", "Google Chrome"),
    "edge": ("search", "Microsoft Edge"),
    "microsoft edge": ("search", "Microsoft Edge"),
    "firefox": ("search", "Firefox"),
    "brave": ("search", "Brave"),
    "coccoc": ("search", "CocCoc"),
    "cốc cốc": ("search", "CocCoc"),
    "zalo": ("search", "Zalo"),
    "telegram": ("search", "Telegram"),
    "discord": ("search", "Discord"),
    "spotify": ("search", "Spotify"),
    "vlc": ("search", "VLC"),
    "obsidian": ("search", "Obsidian"),
    "word": ("search", "Word"),
    "excel": ("search", "Excel"),
    "powerpoint": ("search", "PowerPoint"),
    "outlook": ("search", "Outlook"),
    "onenote": ("search", "OneNote"),
    "teams": ("search", "Teams"),
    "zoom": ("search", "Zoom"),
    "steam": ("search", "Steam"),
    "photoshop": ("search", "Photoshop"),
    "premiere": ("search", "Premiere"),
    "illustrator": ("search", "Illustrator"),
    "capcut": ("search", "CapCut"),
    "bluestacks": ("search", "BlueStacks"),
    "docker": ("search", "Docker Desktop"),
    "postman": ("search", "Postman"),
    "git bash": ("search", "Git Bash"),
}


def _scan_shortcut_dirs():
    """Quét toàn bộ Start Menu và Desktop để lấy danh sách ứng dụng (.lnk, .exe, .url)."""
    roots = []
    appdata = os.environ.get("APPDATA", "")
    progdata = os.environ.get("PROGRAMDATA", "C:\\ProgramData")
    localappdata = os.environ.get("LOCALAPPDATA", "")
    home = os.path.expanduser("~")

    if appdata:
        roots.append(os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs"))
    if progdata:
        roots.append(os.path.join(progdata, "Microsoft", "Windows", "Start Menu", "Programs"))
    roots.append(os.path.join(home, "Desktop"))
    roots.append(os.path.join(home, "OneDrive", "Desktop"))
    roots.append("C:\\Users\\Public\\Desktop")
    if localappdata:
        roots.append(os.path.join(localappdata, "Programs"))

    entries = []
    seen = set()
    skip_words = ("uninstall", "gỡ cài đặt", "readme", "help", "manual", "website", "license", "update")

    for r in roots:
        if not r or not os.path.isdir(r):
            continue
        for dirpath, dirnames, filenames in os.walk(r):
            # Giới hạn độ sâu để quét cực nhanh
            rel_depth = dirpath[len(r):].count(os.sep)
            if rel_depth > 3:
                dirnames[:] = []
                continue
            for fn in filenames:
                low = fn.lower()
                if not low.endswith((".lnk", ".exe", ".url")):
                    continue
                if any(w in low for w in skip_words):
                    continue
                name = os.path.splitext(fn)[0]
                full = os.path.join(dirpath, fn)
                key = (name.lower(), full.lower())
                if key not in seen:
                    seen.add(key)
                    entries.append({"name": name, "path": full, "source": "shortcut" if low.endswith(".lnk") else "file"})
    return entries


def _scan_registry_app_paths():
    """Đọc App Paths từ Windows Registry."""
    if not _common.is_windows():
        return []
    entries = []
    try:
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            subkey = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"
            try:
                with winreg.OpenKey(hive, subkey) as k:
                    i = 0
                    while True:
                        try:
                            exe_name = winreg.EnumKey(k, i)
                            i += 1
                            with winreg.OpenKey(k, exe_name) as sk:
                                val, _ = winreg.QueryValueEx(sk, "")
                                if val and isinstance(val, str):
                                    clean_path = val.strip().strip('"')
                                    if os.path.exists(clean_path):
                                        base = os.path.splitext(exe_name)[0]
                                        entries.append({"name": base, "path": clean_path, "source": "registry"})
                        except OSError:
                            break
            except OSError:
                pass
    except Exception:
        pass
    return entries


def discover_all_apps():
    """Trả về danh sách hợp nhất các ứng dụng trên máy."""
    items = _scan_shortcut_dirs() + _scan_registry_app_paths()
    # Khử trùng lặp theo tên hiển thị ưu tiên .lnk và registry
    dedup = {}
    for it in items:
        k = it["name"].strip().lower()
        if not k or k == "desktop":
            continue
        if k not in dedup:
            dedup[k] = it
    return sorted(dedup.values(), key=lambda x: x["name"].lower())


def match_score(app_name, query):
    """Chấm điểm độ khớp giữa tên ứng dụng và câu truy vấn."""
    a = app_name.lower().strip()
    q = query.lower().strip()
    if q.endswith(".exe"):
        q_bare = q[:-4]
    else:
        q_bare = q

    if a == q or a == q_bare:
        return 100
    if a.startswith(q_bare):
        return 85
    # Khớp theo từng từ
    q_words = [w for w in q_bare.replace("-", " ").replace("_", " ").split() if w]
    a_words = [w for w in a.replace("-", " ").replace("_", " ").split() if w]
    if q_words and all(any(aw.startswith(qw) for aw in a_words) for qw in q_words):
        return 75
    if q_bare in a:
        return 60
    return 0


def search_apps(query, limit=15):
    q = (query or "").strip()
    if not q:
        return []
    all_apps = discover_all_apps()
    scored = []
    for app in all_apps:
        s = match_score(app["name"], q)
        if s == 0:
            # Thử chấm với tên file thực thi trong path
            base_exe = os.path.splitext(os.path.basename(app["path"]))[0]
            s = match_score(base_exe, q)
        if s > 0:
            scored.append((s, app))
    scored.sort(key=lambda x: (-x[0], len(x[1]["name"])))
    return [item[1] for item in scored[: max(1, int(limit))]]


def _start_path(target_path, extra_args=None):
    """Khởi chạy file/shortcut/exe an toàn trên Windows."""
    if extra_args:
        subprocess.Popen([target_path] + list(extra_args), close_fds=True)
    else:
        if hasattr(os, "startfile"):
            os.startfile(target_path)
        else:
            subprocess.Popen([target_path], close_fds=True)


def launch_app(query, extra_args=None):
    raw = (query or "").strip().strip('"').strip("'")
    if not raw:
        _common.fail("Thiếu tên hoặc đường dẫn ứng dụng cần mở.")

    arg_list = [a for a in (extra_args or "").split(" ") if a] if isinstance(extra_args, str) and extra_args.strip() else []

    # 1. Nếu là đường dẫn tuyệt đối tồn tại trên ổ đĩa
    expanded = os.path.expandvars(os.path.expanduser(raw))
    if os.path.exists(expanded):
        _start_path(expanded, arg_list)
        return {
            "launched": os.path.basename(expanded),
            "target": expanded,
            "method": "direct_path",
            "message": f"Đã mở '{os.path.basename(expanded)}'.",
        }

    # 2. Kiểm tra bảng SMART_ALIASES
    low = raw.lower()
    low_no_exe = low[:-4] if low.endswith(".exe") else low
    alias = SMART_ALIASES.get(low) or SMART_ALIASES.get(low_no_exe)
    if alias:
        kind, target = alias
        if kind == "exe":
            which_exe = shutil.which(target) or target
            subprocess.Popen([which_exe] + arg_list, close_fds=True)
            return {"launched": raw, "target": which_exe, "method": "alias_exe", "message": f"Đã mở ứng dụng {target}."}
        elif kind == "uri":
            if hasattr(os, "startfile"):
                os.startfile(target)
            else:
                subprocess.Popen(["explorer.exe", target], close_fds=True)
            return {"launched": raw, "target": target, "method": "alias_uri", "message": f"Đã mở {raw} ({target})."}
        elif kind == "msc":
            mmc = shutil.which("mmc.exe") or "mmc.exe"
            subprocess.Popen([mmc, target], close_fds=True)
            return {"launched": raw, "target": target, "method": "alias_msc", "message": f"Đã mở công cụ hệ thống {target}."}
        elif kind == "search":
            matches = search_apps(target, limit=5)
            if matches:
                best = matches[0]
                _start_path(best["path"], arg_list)
                return {
                    "launched": best["name"],
                    "target": best["path"],
                    "method": "alias_search",
                    "message": f"Đã tìm thấy và mở '{best['name']}'.",
                }

    # 3. Tìm trong Start Menu / Desktop / Registry App Paths
    matches = search_apps(raw, limit=5)
    if matches:
        best = matches[0]
        _start_path(best["path"], arg_list)
        return {
            "launched": best["name"],
            "target": best["path"],
            "method": best["source"],
            "message": f"Đã mở ứng dụng '{best['name']}'.",
        }

    # 4. Tìm trực tiếp trong PATH (shutil.which)
    which_hit = shutil.which(raw) or (shutil.which(raw + ".exe") if not low.endswith(".exe") else None)
    if which_hit:
        subprocess.Popen([which_hit] + arg_list, close_fds=True)
        return {
            "launched": os.path.basename(which_hit),
            "target": which_hit,
            "method": "path_env",
            "message": f"Đã khởi chạy '{os.path.basename(which_hit)}' từ PATH.",
        }

    # 5. Tìm trong Windows StartApps (UWP / Microsoft Store apps như Calculator, Camera, Clock, WhatsApp, Netflix...)
    if _common.is_windows():
        try:
            ps_script = (
                "Get-StartApps | Where-Object { $_.Name -like ('*' + $env:IRIS_APP_QUERY + '*') } "
                "| Select-Object -First 1 -Property Name, AppID | ConvertTo-Json -Compress"
            )
            env = dict(os.environ)
            env["IRIS_APP_QUERY"] = low_no_exe
            proc = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True,
                timeout=8,
                env=env,
            )
            out = _common.decode_bytes(proc.stdout).strip()
            if out and out.startswith("{"):
                import json
                info = json.loads(out)
                app_id = info.get("AppID")
                app_name = info.get("Name") or raw
                if app_id:
                    subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{app_id}"], close_fds=True)
                    return {
                        "launched": app_name,
                        "target": f"shell:AppsFolder\\{app_id}",
                        "method": "uwp_startapps",
                        "message": f"Đã mở ứng dụng Windows '{app_name}'.",
                    }
        except Exception:
            pass

    _common.fail(
        f"Không tìm thấy ứng dụng '{raw}' trên máy tính (đã tìm trong Start Menu, Desktop, Registry, PATH và Microsoft Store)."
    )


def build_parser():
    p = _common.ArgParser(description="Tìm kiếm và khởi chạy mọi ứng dụng trên Windows.")
    sub = p.add_subparsers(dest="command", required=True)

    sp_launch = sub.add_parser("launch", help="Tìm và mở một ứng dụng theo tên hoặc đường dẫn.")
    sp_launch.add_argument("query", help="Tên ứng dụng (vd: 'Zalo', 'Word', 'Chrome', 'Calculator') hoặc đường dẫn.")
    sp_launch.add_argument("--args", default="", help="Tham số dòng lệnh tuỳ chọn.")

    sp_search = sub.add_parser("search", help="Tìm kiếm ứng dụng cài trên máy.")
    sp_search.add_argument("query", help="Từ khoá tìm kiếm.")
    sp_search.add_argument("--limit", type=int, default=15)

    sp_list = sub.add_parser("list", help="Liệt kê các ứng dụng đã cài đặt.")
    sp_list.add_argument("--limit", type=int, default=50)

    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    args = build_parser().parse_args()
    if args.command == "launch":
        res = launch_app(args.query, args.args)
        _common.emit(True, **res)
    elif args.command == "search":
        results = search_apps(args.query, args.limit)
        _common.emit(True, query=args.query, count=len(results), apps=results)
    elif args.command == "list":
        apps = discover_all_apps()[: max(1, int(args.limit))]
        _common.emit(True, count=len(apps), apps=apps)
