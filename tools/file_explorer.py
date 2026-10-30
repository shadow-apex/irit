"""
tools/file_explorer.py — mở thư mục hoặc chọn file trong Windows File Explorer.

    python tools/file_explorer.py <path> [--action=auto|explore|select|open]
    python tools/file_explorer.py --path="C:\\path" [--select]

Hỗ trợ:
- Mở thư mục trực tiếp trong File Explorer: explorer.exe "C:\\Users\\..."
- Chọn (highlight) file/thư mục trong File Explorer: explorer.exe /select,"C:\\path\\to\\file.ext"
- Mở file trực tiếp bằng ứng dụng mặc định: os.startfile(path)
- Các thư mục shortcut: desktop, downloads, documents, pictures, music, videos, home, appdata, temp
- Tự động mở rộng biến môi trường (%USERPROFILE%, %TEMP%, ~)
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

SPECIAL_SHORTCUTS = {
    "desktop": lambda: os.path.join(os.path.expanduser("~"), "Desktop"),
    "downloads": lambda: os.path.join(os.path.expanduser("~"), "Downloads"),
    "documents": lambda: os.path.join(os.path.expanduser("~"), "Documents"),
    "docs": lambda: os.path.join(os.path.expanduser("~"), "Documents"),
    "pictures": lambda: os.path.join(os.path.expanduser("~"), "Pictures"),
    "photos": lambda: os.path.join(os.path.expanduser("~"), "Pictures"),
    "images": lambda: os.path.join(os.path.expanduser("~"), "Pictures"),
    "videos": lambda: os.path.join(os.path.expanduser("~"), "Videos"),
    "music": lambda: os.path.join(os.path.expanduser("~"), "Music"),
    "home": lambda: os.path.expanduser("~"),
    "user": lambda: os.path.expanduser("~"),
    "userprofile": lambda: os.path.expanduser("~"),
    "appdata": lambda: os.environ.get("APPDATA", ""),
    "localappdata": lambda: os.environ.get("LOCALAPPDATA", ""),
    "temp": lambda: os.environ.get("TEMP", os.environ.get("TMP", "C:\\Windows\\Temp")),
    "windows": lambda: os.environ.get("WINDIR", "C:\\Windows"),
    "system32": lambda: os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "System32"),
}


def resolve_target_path(raw_path):
    """Phân giải đường dẫn, mở rộng biến môi trường và shortcut đặc biệt."""
    if not raw_path or not str(raw_path).strip():
        return os.path.expanduser("~")

    clean = str(raw_path).strip().strip('"').strip("'")
    lower = clean.lower()

    if lower in SPECIAL_SHORTCUTS:
        return os.path.normpath(SPECIAL_SHORTCUTS[lower]())

    # Hỗ trợ tiền tố đường dẫn thư mục cá nhân (documents/..., desktop/..., downloads/...)
    # Tự động nhận diện thư mục đồng bộ OneDrive nếu có
    home = os.path.expanduser("~")
    for prefix in ("documents", "docs", "desktop", "downloads"):
        if lower.startswith(prefix + "/") or lower.startswith(prefix + "\\"):
            subpath = clean[len(prefix) + 1:]
            folder_name = "Documents" if prefix in ("documents", "docs") else "Desktop" if prefix == "desktop" else "Downloads"
            candidates = [
                os.path.join(home, "OneDrive", folder_name, subpath),
                os.path.join(home, folder_name, subpath),
            ]
            for c in candidates:
                if os.path.exists(c):
                    return os.path.normpath(c)
            if os.path.isdir(os.path.join(home, "OneDrive", folder_name)):
                return os.path.normpath(candidates[0])
            return os.path.normpath(candidates[1])

    # Xử lý ổ đĩa dạng C: hoặc d: -> C:\
    if len(clean) == 2 and clean[1] == ":" and clean[0].isalpha():
        clean = f"{clean}\\"

    expanded = os.path.expandvars(os.path.expanduser(clean))
    return os.path.normpath(os.path.abspath(expanded))


def open_in_explorer(resolved_path, action="auto"):
    """
    Thực hiện mở trong File Explorer hoặc ứng dụng liên kết.
    - action == 'select': mở thư mục cha và bôi đen file/thư mục bằng explorer.exe /select,<path>
    - action == 'open': mở file trực tiếp bằng ứng dụng mặc định (nếu là thư mục -> mở Explorer)
    - action == 'explore': mở thư mục trong File Explorer
    - action == 'auto': nếu là file -> select; nếu là thư mục -> explore
    """
    if not os.path.exists(resolved_path):
        _common.fail(f"Đường dẫn không tồn tại: {resolved_path}")

    is_dir = os.path.isdir(resolved_path)

    if action == "open":
        opened = False
        if hasattr(os, "startfile"):
            try:
                os.startfile(resolved_path)
                opened = True
            except Exception:
                pass

        if not opened:
            acad_path = r"C:\Program Files\Autodesk\AutoCAD 2021\acad.exe"
            if resolved_path.lower().endswith((".dwg", ".dxf", ".scr")) and os.path.isfile(acad_path):
                subprocess.Popen([acad_path, resolved_path])
            else:
                subprocess.Popen(["explorer.exe", resolved_path])
        return {
            "action": "open",
            "path": resolved_path,
            "is_directory": is_dir,
            "message": f"Đã mở {'thư mục' if is_dir else 'file'} '{resolved_path}'.",
        }

    should_select = False
    if action == "select":
        should_select = True
    elif action == "explore":
        should_select = False
    elif action == "auto":
        should_select = not is_dir

    if should_select:
        # explorer.exe /select,"C:\path\to\file"
        subprocess.Popen(["explorer.exe", f"/select,{resolved_path}"])
        return {
            "action": "select",
            "path": resolved_path,
            "is_directory": is_dir,
            "message": f"Đã mở File Explorer và bôi đen '{os.path.basename(resolved_path)}'.",
        }
    else:
        # explorer.exe "C:\path\to\folder"
        subprocess.Popen(["explorer.exe", resolved_path])
        return {
            "action": "explore",
            "path": resolved_path,
            "is_directory": is_dir,
            "message": f"Đã mở thư mục '{resolved_path}' trong File Explorer.",
        }


def build_parser():
    p = _common.ArgParser(description="Mở thư mục hoặc file trong Windows File Explorer.")
    p.add_argument("path", nargs="?", default="", help="Đường dẫn file hoặc thư mục cần mở.")
    p.add_argument("--path", dest="path_opt", default=None, help="Đường dẫn file hoặc thư mục (tuỳ chọn).")
    p.add_argument(
        "--action",
        choices=["auto", "explore", "select", "open"],
        default="auto",
        help="Hành động: auto (tự động), explore (mở thư mục), select (bôi đen file trong thư mục), open (mở file).",
    )
    p.add_argument("--select", action="store_true", help="Bôi đen/chọn file hoặc thư mục trong File Explorer.")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    args = build_parser().parse_args()
    raw = args.path_opt if args.path_opt is not None else args.path
    action = "select" if args.select else args.action
    resolved = resolve_target_path(raw)
    result = open_in_explorer(resolved, action)
    _common.emit(True, **result)
