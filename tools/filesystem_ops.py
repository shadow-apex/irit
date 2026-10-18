"""
tools/filesystem_ops.py — Quản lý File & Thư mục toàn diện trên máy tính.

    python tools/filesystem_ops.py list <path> [--limit=100]
    python tools/filesystem_ops.py read <path> [--max-bytes=100000]
    python tools/filesystem_ops.py write <path> [--append] --stdin
    python tools/filesystem_ops.py mkdir <path>
    python tools/filesystem_ops.py copy <src> <dest>
    python tools/filesystem_ops.py move <src> <dest>
    python tools/filesystem_ops.py rename <src> <new_name>
    python tools/filesystem_ops.py delete <path>
    python tools/filesystem_ops.py info <path>
    python tools/filesystem_ops.py zip <src> <dest_zip>
    python tools/filesystem_ops.py unzip <src_zip> <dest_dir>

Hỗ trợ shortcut thư mục (desktop, downloads, documents, pictures, videos, music, home, temp, appdata)
và biến môi trường (%USERPROFILE%, ~).
"""
import hashlib
import os
import shutil
import stat
import sys
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402
from file_explorer import resolve_target_path  # noqa: E402

PROTECTED_PATHS = frozenset(
    {
        "c:\\",
        "c:\\windows",
        "c:\\windows\\system32",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\users",
    }
)


def _check_safe_modify(resolved_path):
    norm = os.path.normcase(os.path.normpath(resolved_path)).rstrip("\\")
    if norm in PROTECTED_PATHS or (len(norm) == 2 and norm[1] == ":"):
        _common.fail(f"Đường dẫn hệ thống tối quan trọng được bảo vệ, từ chối sửa/xoá: {resolved_path}")


def list_dir(raw_path, limit=100):
    p = resolve_target_path(raw_path)
    if not os.path.exists(p):
        _common.fail(f"Đường dẫn không tồn tại: {p}")
    if not os.path.isdir(p):
        _common.fail(f"Không phải là thư mục: {p}")

    items = []
    try:
        with os.scandir(p) as it:
            entries = list(it)
    except PermissionError:
        _common.fail(f"Không có quyền truy cập thư mục: {p}")

    # Sắp xếp thư mục lên trước, sau đó theo tên
    entries.sort(key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
    for entry in entries[: max(1, int(limit))]:
        try:
            st = entry.stat(follow_symlinks=False)
            is_d = entry.is_dir(follow_symlinks=False)
            items.append(
                {
                    "name": entry.name,
                    "type": "dir" if is_d else "file",
                    "size_bytes": 0 if is_d else int(st.st_size),
                    "modified": int(st.st_mtime),
                }
            )
        except Exception:
            items.append({"name": entry.name, "type": "unknown"})

    return {
        "action": "list",
        "path": p,
        "total_entries": len(entries),
        "shown_entries": len(items),
        "items": items,
        "message": f"Thư mục '{p}' có {len(entries)} mục.",
    }


def read_file(raw_path, max_bytes=100000):
    p = resolve_target_path(raw_path)
    if not os.path.exists(p):
        _common.fail(f"File không tồn tại: {p}")
    if os.path.isdir(p):
        _common.fail(f"'{p}' là thư mục, hãy dùng action='list' để xem danh sách bên trong.")

    max_b = max(1024, min(int(max_bytes or 100000), 500000))
    size = os.path.getsize(p)
    with open(p, "rb") as f:
        raw = f.read(max_b)

    content = _common.decode_bytes(raw)
    return {
        "action": "read",
        "path": p,
        "size_bytes": size,
        "truncated": size > max_b,
        "content": content,
        "message": f"Đã đọc file '{os.path.basename(p)}' ({size} bytes).",
    }


def write_file(raw_path, content, append=False):
    p = resolve_target_path(raw_path)
    _check_safe_modify(p)
    parent = os.path.dirname(p)
    if parent:
        os.makedirs(parent, exist_ok=True)
    mode = "a" if append else "w"
    with open(p, mode, encoding="utf-8") as f:
        f.write(content or "")
    size = os.path.getsize(p)
    return {
        "action": "append" if append else "write",
        "path": p,
        "size_bytes": size,
        "message": f"Đã {'ghi thêm vào' if append else 'ghi'} file '{p}' ({size} bytes).",
    }


def make_dir(raw_path):
    p = resolve_target_path(raw_path)
    os.makedirs(p, exist_ok=True)
    return {"action": "mkdir", "path": p, "message": f"Đã tạo thư mục '{p}'."}


def copy_item(raw_src, raw_dest):
    src = resolve_target_path(raw_src)
    dest = resolve_target_path(raw_dest)
    if not os.path.exists(src):
        _common.fail(f"Nguồn không tồn tại: {src}")
    if os.path.isdir(src):
        if os.path.isdir(dest):
            dest = os.path.join(dest, os.path.basename(src))
        shutil.copytree(src, dest, dirs_exist_ok=True)
    else:
        if os.path.isdir(dest):
            dest = os.path.join(dest, os.path.basename(src))
        else:
            parent = os.path.dirname(dest)
            if parent:
                os.makedirs(parent, exist_ok=True)
        shutil.copy2(src, dest)
    return {"action": "copy", "source": src, "destination": dest, "message": f"Đã sao chép '{src}' sang '{dest}'."}


def move_item(raw_src, raw_dest):
    src = resolve_target_path(raw_src)
    dest = resolve_target_path(raw_dest)
    if not os.path.exists(src):
        _common.fail(f"Nguồn không tồn tại: {src}")
    _check_safe_modify(src)
    if os.path.isdir(dest):
        dest = os.path.join(dest, os.path.basename(src))
    else:
        parent = os.path.dirname(dest)
        if parent:
            os.makedirs(parent, exist_ok=True)
    moved_to = shutil.move(src, dest)
    return {"action": "move", "source": src, "destination": moved_to, "message": f"Đã di chuyển '{src}' tới '{moved_to}'."}


def rename_item(raw_src, new_name):
    src = resolve_target_path(raw_src)
    if not os.path.exists(src):
        _common.fail(f"File/thư mục không tồn tại: {src}")
    _check_safe_modify(src)
    clean_new = os.path.basename(str(new_name or "").strip())
    if not clean_new:
        _common.fail("Tên mới không hợp lệ.")
    dest = os.path.join(os.path.dirname(src), clean_new)
    os.rename(src, dest)
    return {"action": "rename", "old_path": src, "new_path": dest, "message": f"Đã đổi tên thành '{clean_new}'."}


def delete_item(raw_path):
    p = resolve_target_path(raw_path)
    if not os.path.exists(p):
        _common.fail(f"Đường dẫn không tồn tại: {p}")
    _check_safe_modify(p)
    if os.path.isdir(p) and not os.path.islink(p):
        shutil.rmtree(p)
        return {"action": "delete", "path": p, "type": "dir", "message": f"Đã xoá thư mục '{p}'."}
    else:
        os.remove(p)
        return {"action": "delete", "path": p, "type": "file", "message": f"Đã xoá file '{p}'."}


def item_info(raw_path):
    p = resolve_target_path(raw_path)
    if not os.path.exists(p):
        _common.fail(f"Đường dẫn không tồn tại: {p}")
    st = os.stat(p)
    is_d = os.path.isdir(p)
    info = {
        "action": "info",
        "path": p,
        "name": os.path.basename(p),
        "type": "dir" if is_d else "file",
        "size_bytes": int(st.st_size),
        "created": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_ctime)),
        "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
        "readonly": not bool(st.st_mode & stat.S_IWRITE),
    }
    if not is_d and st.st_size <= 50 * 1024 * 1024:
        h = hashlib.sha256()
        with open(p, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                h.update(chunk)
        info["sha256"] = h.hexdigest()
    return info


def zip_item(raw_src, raw_dest):
    src = resolve_target_path(raw_src)
    if not os.path.exists(src):
        _common.fail(f"Nguồn không tồn tại: {src}")
    dest = resolve_target_path(raw_dest) if raw_dest else (src.rstrip("\\/") + ".zip")
    if not dest.lower().endswith(".zip"):
        dest += ".zip"
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)

    count = 0
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        if os.path.isdir(src):
            for root, _dirs, files in os.walk(src):
                for fn in files:
                    full = os.path.join(root, fn)
                    rel = os.path.relpath(full, os.path.dirname(src))
                    zf.write(full, rel)
                    count += 1
        else:
            zf.write(src, os.path.basename(src))
            count = 1
    return {
        "action": "zip",
        "source": src,
        "archive": dest,
        "files_archived": count,
        "size_bytes": os.path.getsize(dest),
        "message": f"Đã nén {count} file vào '{dest}'.",
    }


def unzip_item(raw_src, raw_dest):
    src = resolve_target_path(raw_src)
    if not os.path.exists(src):
        _common.fail(f"File zip không tồn tại: {src}")
    dest = resolve_target_path(raw_dest) if raw_dest else os.path.splitext(src)[0]
    os.makedirs(dest, exist_ok=True)
    dest_real = os.path.realpath(dest)
    with zipfile.ZipFile(src, "r") as zf:
        # Chống Zip-Slip
        for member in zf.namelist():
            target_p = os.path.realpath(os.path.join(dest_real, member))
            if not target_p.startswith(dest_real + os.sep) and target_p != dest_real:
                _common.fail(f"Phát hiện đường dẫn không an toàn trong file nén: {member}")
        zf.extractall(dest_real)
        count = len(zf.namelist())
    return {
        "action": "unzip",
        "archive": src,
        "destination": dest_real,
        "entries_extracted": count,
        "message": f"Đã giải nén {count} mục vào '{dest_real}'.",
    }


def build_parser():
    p = _common.ArgParser(description="Quản lý File & Thư mục toàn diện.")
    p.add_argument(
        "action",
        choices=["list", "read", "write", "append", "mkdir", "copy", "move", "rename", "delete", "info", "zip", "unzip"],
    )
    p.add_argument("path", help="Đường dẫn mục tiêu (hoặc nguồn).")
    p.add_argument("--dest", default="", help="Đường dẫn đích (cho copy, move, rename, zip, unzip).")
    p.add_argument("--limit", type=int, default=100, help="Giới hạn số mục hoặc số byte.")
    p.add_argument("--stdin", action="store_true", help="Đọc nội dung cần ghi từ STDIN.")
    p.add_argument("--content", default="", help="Nội dung văn bản (nếu không dùng --stdin).")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    args = build_parser().parse_args()
    try:
        act = args.action
        if act == "list":
            res = list_dir(args.path, limit=args.limit)
        elif act == "read":
            res = read_file(args.path, max_bytes=args.limit)
        elif act in ("write", "append"):
            body = sys.stdin.read() if args.stdin else args.content
            res = write_file(args.path, body, append=(act == "append"))
        elif act == "mkdir":
            res = make_dir(args.path)
        elif act == "copy":
            if not args.dest:
                _common.fail("Thiếu '--dest' cho thao tác copy.")
            res = copy_item(args.path, args.dest)
        elif act == "move":
            if not args.dest:
                _common.fail("Thiếu '--dest' cho thao tác move.")
            res = move_item(args.path, args.dest)
        elif act == "rename":
            if not args.dest:
                _common.fail("Thiếu '--dest' (tên mới) cho thao tác rename.")
            res = rename_item(args.path, args.dest)
        elif act == "delete":
            res = delete_item(args.path)
        elif act == "info":
            res = item_info(args.path)
        elif act == "zip":
            res = zip_item(args.path, args.dest)
        elif act == "unzip":
            res = unzip_item(args.path, args.dest)
        else:
            _common.fail(f"Hành động không hỗ trợ: {act}")
        _common.emit(True, **res)
    except Exception as e:
        _common.fail(str(e))
