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
import errno
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


def _format_fs_error(err, target_path=""):
    """Chuẩn hoá lỗi khoá file (WinError 32) và lỗi từ chối quyền Admin (WinError 5 / PermissionError) sang tiếng Việt rõ ràng."""
    winerr = getattr(err, "winerror", None)
    err_no = getattr(err, "errno", None)
    p_info = f" '{target_path}'" if target_path else ""
    if winerr == 32 or err_no == errno.EBUSY:
        return f"Tệp hoặc thư mục{p_info} đang bị khoá bởi một ứng dụng khác đang mở. Hãy đóng ứng dụng đó rồi thử lại."
    if isinstance(err, PermissionError) or winerr == 5 or err_no in (errno.EACCES, errno.EPERM):
        return f"Không đủ quyền truy cập hoặc quyền Administrator bị từ chối khi thao tác với{p_info}: {err}"
    return str(err)


def _handle_remove_readonly(func, path, exc_info):
    """Xử lý file Read-Only khi xoá thư mục bằng shutil.rmtree trên Windows."""
    exc = exc_info[1] if isinstance(exc_info, tuple) else exc_info
    if isinstance(exc, PermissionError) or getattr(exc, "errno", None) == errno.EACCES:
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
            return
        except Exception:
            pass
    raise exc


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
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, p))

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


def extract_docx_text(file_path):
    """Trích xuất văn bản sạch từ file Word (.docx) bằng thư viện chuẩn (zipfile + xml), không cần cài python-docx."""
    import xml.etree.ElementTree as ET

    paragraphs = []
    with zipfile.ZipFile(file_path, "r") as zf:
        if "word/document.xml" not in zf.namelist():
            return ""
        xml_bytes = zf.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    for elem in root.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag == "p":
            texts = [
                sub.text
                for sub in elem.iter()
                if (sub.tag.split("}")[-1] if "}" in sub.tag else sub.tag) in ("t", "tab") and sub.text
            ]
            line = "".join(texts).strip()
            if line:
                paragraphs.append(line)
    return "\n".join(paragraphs)


def extract_xlsx_text(file_path, max_rows=200):
    """Trích xuất dữ liệu bảng tính từ file Excel (.xlsx) bằng thư viện chuẩn (zipfile + xml), không cần cài openpyxl."""
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(file_path, "r") as zf:
        names = set(zf.namelist())
        shared_strings = []
        if "xl/sharedStrings.xml" in names:
            ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in ss_root:
                s_tag = si.tag.split("}")[-1] if "}" in si.tag else si.tag
                if s_tag == "si":
                    parts = [
                        t.text
                        for t in si.iter()
                        if (t.tag.split("}")[-1] if "}" in t.tag else t.tag) == "t" and t.text
                    ]
                    shared_strings.append("".join(parts))

        sheet_files = sorted(n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
        lines = []
        for sf in sheet_files[:5]:
            sheet_name = os.path.splitext(os.path.basename(sf))[0]
            lines.append(f"### [{sheet_name}]")
            sh_root = ET.fromstring(zf.read(sf))
            row_count = 0
            for elem in sh_root.iter():
                tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                if tag == "row":
                    row_vals = []
                    for c in elem:
                        c_tag = c.tag.split("}")[-1] if "}" in c.tag else c.tag
                        if c_tag != "c":
                            continue
                        c_type = c.attrib.get("t", "")
                        val_text = ""
                        for child in c:
                            ch_tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                            if ch_tag == "v" and child.text is not None:
                                if c_type == "s":
                                    idx = int(child.text)
                                    val_text = shared_strings[idx] if 0 <= idx < len(shared_strings) else child.text
                                else:
                                    val_text = child.text
                            elif ch_tag == "is":
                                val_text = "".join(t.text for t in child.iter() if t.text)
                        row_vals.append(str(val_text).strip())
                    if any(row_vals):
                        lines.append(" | ".join(row_vals))
                        row_count += 1
                        if row_count >= max_rows:
                            lines.append(f"... [đã cắt bớt sau {max_rows} dòng]")
                            break
        return "\n".join(lines)


def read_file(raw_path, max_bytes=100000):
    p = resolve_target_path(raw_path)
    if not os.path.exists(p):
        _common.fail(f"File không tồn tại: {p}")
    if os.path.isdir(p):
        _common.fail(f"'{p}' là thư mục, hãy dùng action='list' để xem danh sách bên trong.")

    max_b = max(1024, min(int(max_bytes or 100000), 500000))
    ext = os.path.splitext(p)[1].lower()
    try:
        size = os.path.getsize(p)
        if ext == ".docx" and zipfile.is_zipfile(p):
            content = extract_docx_text(p)
            truncated = len(content) > max_b
            return {
                "action": "read",
                "path": p,
                "format": "docx",
                "size_bytes": size,
                "truncated": truncated,
                "content": content[:max_b],
                "message": f"Đã trích xuất nội dung văn bản từ file Word '{os.path.basename(p)}' ({len(content)} ký tự).",
            }
        if ext == ".xlsx" and zipfile.is_zipfile(p):
            content = extract_xlsx_text(p)
            truncated = len(content) > max_b
            return {
                "action": "read",
                "path": p,
                "format": "xlsx",
                "size_bytes": size,
                "truncated": truncated,
                "content": content[:max_b],
                "message": f"Đã trích xuất bảng tính từ file Excel '{os.path.basename(p)}' ({len(content)} ký tự).",
            }
        with open(p, "rb") as f:
            raw = f.read(max_b)
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, p))

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
    try:
        parent = os.path.dirname(p)
        if parent:
            os.makedirs(parent, exist_ok=True)
        mode = "a" if append else "w"
        with open(p, mode, encoding="utf-8") as f:
            f.write(content or "")
        size = os.path.getsize(p)
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, p))
    return {
        "action": "append" if append else "write",
        "path": p,
        "size_bytes": size,
        "message": f"Đã {'ghi thêm vào' if append else 'ghi'} file '{p}' ({size} bytes).",
    }


def make_dir(raw_path):
    p = resolve_target_path(raw_path)
    try:
        os.makedirs(p, exist_ok=True)
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, p))
    return {"action": "mkdir", "path": p, "message": f"Đã tạo thư mục '{p}'."}


def copy_item(raw_src, raw_dest):
    src = resolve_target_path(raw_src)
    dest = resolve_target_path(raw_dest)
    if not os.path.exists(src):
        _common.fail(f"Nguồn không tồn tại: {src}")
    try:
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
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, src))
    return {"action": "copy", "source": src, "destination": dest, "message": f"Đã sao chép '{src}' sang '{dest}'."}


def move_item(raw_src, raw_dest):
    src = resolve_target_path(raw_src)
    dest = resolve_target_path(raw_dest)
    if not os.path.exists(src):
        _common.fail(f"Nguồn không tồn tại: {src}")
    _check_safe_modify(src)
    try:
        if os.path.isdir(dest):
            dest = os.path.join(dest, os.path.basename(src))
        else:
            parent = os.path.dirname(dest)
            if parent:
                os.makedirs(parent, exist_ok=True)
        moved_to = shutil.move(src, dest)
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, src))
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
    try:
        os.rename(src, dest)
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, src))
    return {"action": "rename", "old_path": src, "new_path": dest, "message": f"Đã đổi tên thành '{clean_new}'."}


def delete_item(raw_path):
    p = resolve_target_path(raw_path)
    if not os.path.exists(p):
        _common.fail(f"Đường dẫn không tồn tại: {p}")
    _check_safe_modify(p)
    try:
        if os.path.isdir(p) and not os.path.islink(p):
            shutil.rmtree(p, onerror=_handle_remove_readonly)
            return {"action": "delete", "path": p, "type": "dir", "message": f"Đã xoá thư mục '{p}'."}
        else:
            try:
                os.remove(p)
            except PermissionError:
                os.chmod(p, stat.S_IWRITE)
                os.remove(p)
            return {"action": "delete", "path": p, "type": "file", "message": f"Đã xoá file '{p}'."}
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, p))


def item_info(raw_path):
    p = resolve_target_path(raw_path)
    if not os.path.exists(p):
        _common.fail(f"Đường dẫn không tồn tại: {p}")
    try:
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
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, p))


def zip_item(raw_src, raw_dest):
    src = resolve_target_path(raw_src)
    if not os.path.exists(src):
        _common.fail(f"Nguồn không tồn tại: {src}")
    dest = resolve_target_path(raw_dest) if raw_dest else (src.rstrip("\\/") + ".zip")
    if not dest.lower().endswith(".zip"):
        dest += ".zip"
    try:
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
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, src))


def unzip_item(raw_src, raw_dest):
    src = resolve_target_path(raw_src)
    if not os.path.exists(src):
        _common.fail(f"File zip không tồn tại: {src}")
    dest = resolve_target_path(raw_dest) if raw_dest else os.path.splitext(src)[0]
    try:
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
    except (PermissionError, OSError) as e:
        _common.fail(_format_fs_error(e, src))


def grep_files(raw_path, pattern, limit=50):
    """Tìm kiếm chuỗi văn bản bên trong file hoặc thư mục (hỗ trợ cả file văn bản lẫn .docx/.xlsx)."""
    p = resolve_target_path(raw_path)
    q = str(pattern or "").strip()
    if not q:
        _common.fail("Thiếu từ khoá '--content' (hoặc '--dest') để tìm kiếm nội dung trong file.")
    if not os.path.exists(p):
        _common.fail(f"Đường dẫn không tồn tại: {p}")

    q_low = q.lower()
    max_matches = max(1, min(int(limit or 50), 200))
    matches = []
    text_exts = {
        ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm",
        ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".ini", ".cfg", ".log",
        ".bat", ".ps1", ".sh", ".sql", ".env.example", ".docx", ".xlsx",
    }
    skip_dirs = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", "appdata"}

    def _scan_single_file(fp):
        if len(matches) >= max_matches:
            return
        ext = os.path.splitext(fp)[1].lower()
        if os.path.isdir(p) and ext not in text_exts:
            return
        try:
            sz = os.path.getsize(fp)
            if sz > 5 * 1024 * 1024:
                return
            if ext == ".docx" and zipfile.is_zipfile(fp):
                text = extract_docx_text(fp)
            elif ext == ".xlsx" and zipfile.is_zipfile(fp):
                text = extract_xlsx_text(fp)
            else:
                with open(fp, "rb") as f:
                    text = _common.decode_bytes(f.read(512 * 1024))
            for line_no, line in enumerate(text.splitlines(), 1):
                if q_low in line.lower():
                    matches.append(
                        {
                            "file": fp,
                            "line": line_no,
                            "snippet": line.strip()[:240],
                        }
                    )
                    if len(matches) >= max_matches:
                        break
        except Exception:
            pass

    if os.path.isfile(p):
        _scan_single_file(p)
    else:
        for root_dir, dirnames, filenames in os.walk(p):
            dirnames[:] = [d for d in dirnames if d.lower() not in skip_dirs and not d.startswith(".")]
            for fn in filenames:
                _scan_single_file(os.path.join(root_dir, fn))
                if len(matches) >= max_matches:
                    break
            if len(matches) >= max_matches:
                break

    return {
        "action": "grep",
        "path": p,
        "query": q,
        "count": len(matches),
        "matches": matches,
        "first_path": matches[0]["file"] if matches else None,
        "message": f"Tìm thấy {len(matches)} dòng khớp '{q}' trong '{p}'.",
    }


def build_parser():
    p = _common.ArgParser(description="Quản lý File & Thư mục toàn diện.")
    p.add_argument(
        "action",
        choices=[
            "list",
            "read",
            "write",
            "append",
            "mkdir",
            "copy",
            "move",
            "rename",
            "delete",
            "info",
            "zip",
            "unzip",
            "grep",
        ],
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
        elif act == "grep":
            query_str = (sys.stdin.read() if args.stdin else args.content) or args.dest
            res = grep_files(args.path, query_str, limit=args.limit)
        else:
            _common.fail(f"Hành động không hỗ trợ: {act}")
        _common.emit(True, **res)
    except Exception as e:
        _common.fail(_format_fs_error(e, getattr(args, "path", "")))
