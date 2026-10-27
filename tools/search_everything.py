"""
tools/search_everything.py — Tìm file siêu tốc đa tầng: Everything CLI (es.exe) + Native Multi-Root Fallback.

    python tools/search_everything.py "<từ khoá>" [--max N]

TL-10:
- Đọc stdout dạng BYTES, giải mã UTF-8 → OEM (đường dẫn có dấu tiếng Việt không còn vỡ).
- Từ chối truy vấn bắt đầu bằng '-' hoặc '/' (es.exe sẽ hiểu là cờ).
- Tự động dò tìm es.exe trong PATH và Program Files; nếu máy chưa cài Everything hoặc dịch vụ chưa bật,
  tự động chuyển sang bộ quét Native Multi-Root tốc độ cao hỗ trợ khớp tiếng Việt không dấu (ví dụ:
  tìm 'bao cao' khớp được 'Báo_cáo_Q3.xlsx').
"""
import os
import shutil
import subprocess
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_RESULTS = 100
SKIP_DIRS = frozenset(
    {
        "node_modules",
        ".git",
        ".hg",
        ".svn",
        "__pycache__",
        ".venv",
        "venv",
        "appdata",
        "$recycle.bin",
        "system volume information",
        ".cache",
        ".npm",
        ".cargo",
        ".rustup",
    }
)


def strip_accents(text):
    """Bỏ dấu tiếng Việt để hỗ trợ tìm kiếm không dấu ('bao cao' -> 'bao cao')."""
    if not text:
        return ""
    s = str(text).replace("đ", "d").replace("Đ", "D")
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch)).lower()


def validate_query(q):
    if not isinstance(q, str) or not q.strip():
        raise ValueError("Truy vấn rỗng.")
    s = q.strip()
    if s[0] in "-/":
        raise ValueError("Truy vấn không được bắt đầu bằng '-' hoặc '/' (es.exe sẽ hiểu là cờ lệnh).")
    if len(s) > 200 or any(ord(c) < 32 for c in s):
        raise ValueError("Truy vấn quá dài hoặc chứa ký tự điều khiển.")
    return s


def parse_results(raw_bytes):
    text = _common.decode_bytes(raw_bytes)
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def find_es_binary():
    """Tự động dò tìm es.exe trong PATH hoặc các thư mục cài đặt chuẩn của Everything."""
    found = shutil.which("es.exe") or shutil.which("es")
    if found:
        return found
    candidates = [
        r"C:\Program Files\Everything\es.exe",
        r"C:\Program Files (x86)\Everything\es.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Everything", "es.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links", "es.exe"),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def score_filename_match(filename, query_norm, query_tokens):
    """Chấm điểm độ khớp giữa tên file/thư mục và truy vấn (hỗ trợ cả có dấu & không dấu, _ và -)."""
    name_norm = strip_accents(filename).replace("_", " ").replace("-", " ")
    stem_norm = strip_accents(os.path.splitext(filename)[0]).replace("_", " ").replace("-", " ")
    q_clean = query_norm.replace("_", " ").replace("-", " ")
    if name_norm == q_clean or stem_norm == q_clean:
        return 100
    if name_norm.startswith(q_clean) or stem_norm.startswith(q_clean):
        return 85
    if q_clean in name_norm:
        return 75
    if query_tokens and all(tok in name_norm for tok in query_tokens):
        return 65
    return 0


def search_native_fallback(query, max_results=10, roots=None, max_depth=4):
    """Quét nhanh các thư mục người dùng khi máy không có Everything CLI (es.exe)."""
    q_norm = strip_accents(query)
    q_tokens = [t for t in q_norm.replace("_", " ").replace("-", " ").split() if t]
    if not q_norm:
        return []

    if roots is None:
        home = os.path.expanduser("~")
        roots = [
            os.path.join(home, "Desktop"),
            os.path.join(home, "Downloads"),
            os.path.join(home, "Documents"),
            os.path.join(home, "OneDrive", "Desktop"),
            os.path.join(home, "OneDrive", "Documents"),
            os.path.join(home, "Pictures"),
            os.path.join(home, "Videos"),
            home,
        ]

    visited_dirs = set()
    seen_paths = set()
    scored = []

    for root in roots:
        if not root or not os.path.isdir(root):
            continue
        norm_root = os.path.normcase(os.path.abspath(root))

        def _walk_dir(cur_dir, depth):
            if depth > max_depth or len(scored) >= 800:
                return
            norm_cur = os.path.normcase(cur_dir)
            if norm_cur in visited_dirs:
                return
            visited_dirs.add(norm_cur)

            try:
                with os.scandir(cur_dir) as it:
                    entries = list(it)
            except OSError:
                return

            subdirs = []
            for entry in entries:
                name = entry.name
                low = name.lower()
                if low in SKIP_DIRS or (name.startswith(".") and len(name) > 1):
                    continue
                sc = score_filename_match(name, q_norm, q_tokens)
                if sc > 0:
                    norm_p = os.path.normcase(entry.path)
                    if norm_p not in seen_paths:
                        seen_paths.add(norm_p)
                        try:
                            mtime = entry.stat(follow_symlinks=False).st_mtime
                        except OSError:
                            mtime = 0.0
                        scored.append((sc, mtime, entry.path))
                try:
                    if depth < max_depth and entry.is_dir(follow_symlinks=False):
                        subdirs.append(entry.path)
                except OSError:
                    pass

            for sd in subdirs:
                _walk_dir(sd, depth + 1)

        # Với thư mục home gốc, chỉ quét độ sâu 2 để tránh duyệt quá sâu
        eff_depth = 2 if norm_root == os.path.normcase(os.path.abspath(os.path.expanduser("~"))) else max_depth
        _walk_dir(root, 0 if eff_depth == max_depth else (max_depth - eff_depth))

    scored.sort(key=lambda x: (-x[0], -x[1]))
    limit = max(1, min(int(max_results or 10), MAX_RESULTS))
    return [item[2] for item in scored[:limit]]


def enrich_results(paths):
    """Bổ sung metadata chi tiết cho từng kết quả để phục vụ Agentic Tool Chaining."""
    detailed = []
    for p in paths:
        try:
            st = os.stat(p)
            is_d = os.path.isdir(p)
            detailed.append(
                {
                    "path": p,
                    "name": os.path.basename(p.rstrip("\\/")) or p,
                    "is_dir": is_d,
                    "size_bytes": 0 if is_d else int(st.st_size),
                }
            )
        except OSError:
            detailed.append(
                {
                    "path": p,
                    "name": os.path.basename(p.rstrip("\\/")) or p,
                    "is_dir": False,
                    "size_bytes": 0,
                }
            )
    return detailed


def run_search(query, max_results=10):
    q = validate_query(query)
    n = max(1, min(int(max_results or 10), MAX_RESULTS))
    es_bin = find_es_binary()
    results = []
    engine = "native_fallback"

    if es_bin:
        try:
            r = subprocess.run([es_bin, "-n", str(n), q], capture_output=True, check=False, timeout=8)
            if r.returncode == 0:
                results = parse_results(r.stdout)
                if results:
                    engine = "everything_cli"
        except Exception:
            results = []

    if not results:
        results = search_native_fallback(q, max_results=n)
        engine = "native_fallback"

    detailed = enrich_results(results)
    return {
        "query": q,
        "results": results,
        "count": len(results),
        "first_path": results[0] if results else None,
        "detailed_results": detailed,
        "engine": engine,
    }


def build_parser():
    p = _common.ArgParser(description="Tìm file bằng Everything (es.exe) hoặc Native Multi-Root Fallback")
    p.add_argument("query")
    p.add_argument("--max", type=int, default=10)
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    try:
        payload = run_search(a.query, a.max)
    except ValueError as e:
        _common.fail(str(e))
    except Exception as e:  # noqa: BLE001
        _common.fail(str(e))
    _common.emit(True, **payload)
