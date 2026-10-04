"""
tools/_common.py — thư viện dùng chung cho mọi script trong tools/.

Schema đầu ra DUY NHẤT: đúng MỘT dòng JSON trên stdout
    {"success": true,  ...fields}
    {"success": false, "error": "<lý do>", ...fields}   và tiến trình thoát với mã ≠ 0.

Không tự `pip install`, không `os.system`, không `shell=True` (xem tools/README.md).
Module này KHÔNG import thư viện chỉ-Windows ở cấp module, nên import được trên mọi OS
(để chạy unit test cho các hàm thuần).
"""
import argparse
import importlib
import io
import json
import os
import re
import sys

# --------------------------------------------------------------------------- IO / schema


def ensure_utf8():
    """Ép stdout/stderr dùng UTF-8 (console Windows mặc định là code page OEM)."""
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name)
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            try:
                setattr(sys, name, io.TextIOWrapper(stream.buffer, encoding="utf-8", errors="replace"))
            except Exception:
                pass


def emit(success=True, **fields):
    """In MỘT dòng JSON. success=False ⇒ thoát mã 1."""
    payload = {"success": bool(success)}
    payload.update(fields)
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    if not success:
        sys.exit(1)


def fail(error, code=1, **fields):
    """In JSON lỗi rồi thoát với mã `code` (≠ 0)."""
    payload = {"success": False, "error": str(error)}
    payload.update(fields)
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.exit(code if code else 1)


class ArgParser(argparse.ArgumentParser):
    """argparse nhưng lỗi tham số cũng theo schema JSON (success:false) và thoát mã 2."""

    def error(self, message):
        fail(f"Tham số không hợp lệ: {message}", code=2)


def require(module, pip_name=None):
    """Import module hoặc fail() rõ ràng — KHÔNG tự cài đặt."""
    try:
        return importlib.import_module(module)
    except ImportError:
        fail(f"Thiếu thư viện '{pip_name or module}'. Cài bằng: pip install -r tools/requirements.txt")


def dpi_aware():
    """Đặt process DPI-aware (toạ độ = pixel vật lý). An toàn khi gọi trên OS khác."""
    try:
        import ctypes

        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE_V2
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def is_windows():
    return sys.platform == "win32"


def user_data_dir():
    """Nơi ghi dữ liệu runtime: IRIS_USER_DATA (Node truyền vào) → %LOCALAPPDATA%\\Iris → ~/.iris."""
    d = os.environ.get("IRIS_USER_DATA", "").strip()
    if not d:
        base = os.environ.get("LOCALAPPDATA", "").strip()
        d = os.path.join(base, "Iris") if base else os.path.join(os.path.expanduser("~"), ".iris")
    os.makedirs(d, exist_ok=True)
    return d


def private_chmod(path):
    """Quyền 0600 (best effort; trên Windows chỉ có tác dụng hạn chế)."""
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass


# --------------------------------------------------------------------------- encoding


def get_oem_codepage():
    try:
        import ctypes

        return int(ctypes.windll.kernel32.GetOEMCP())
    except Exception:
        return None


def decode_bytes(data, oem_cp=None):
    """Giải mã đầu ra của công cụ dòng lệnh Windows (netsh, es.exe...).

    Thử UTF-8 nghiêm ngặt trước; nếu hỏng thì dùng code page OEM (netsh xuất theo OEM,
    vd. cp1258 trên Windows tiếng Việt); cuối cùng latin-1 để không bao giờ ném lỗi.
    """
    if data is None:
        return ""
    if isinstance(data, str):
        return data
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    cp = oem_cp if oem_cp is not None else get_oem_codepage()
    if cp:
        try:
            return data.decode(f"cp{cp}")
        except (LookupError, UnicodeDecodeError):
            pass
    return data.decode("latin-1", errors="replace")


# --------------------------------------------------------------------------- tên tiến trình (TL-02)

PROTECTED_PROCESSES = frozenset(
    {
        "explorer.exe", "winlogon.exe", "csrss.exe", "wininit.exe", "services.exe", "lsass.exe",
        "svchost.exe", "dwm.exe", "smss.exe", "system", "registry",
        # chính Iris và các thành phần của nó
        "electron.exe", "iris.exe", "claude.exe", "node.exe", "python.exe", "pythonw.exe", "py.exe",
    }
)

_PROC_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._()\-]{0,63}$")


def protected_processes():
    extra = {p.strip().lower() for p in os.environ.get("IRIS_PROTECTED_PROCESSES", "").split(",") if p.strip()}
    return PROTECTED_PROCESSES | extra


def validate_process_name(name):
    """Chuẩn hoá + kiểm tra tên tiến trình. Trả về tên có đuôi .exe, hoặc ném ValueError.

    Từ chối: rỗng, ký tự đại diện (* ?), dấu đường dẫn (/ \\ :), quá dài, ký tự lạ, và mọi
    tiến trình trong danh sách bảo vệ (hệ điều hành + chính Iris).
    """
    if not isinstance(name, str):
        raise ValueError("Tên tiến trình phải là chuỗi.")
    n = name.strip()
    if not n:
        raise ValueError("Tên tiến trình rỗng.")
    for ch in ("*", "?", "/", "\\", ":"):
        if ch in n:
            raise ValueError(f"Tên tiến trình không được chứa '{ch}'.")
    if not _PROC_NAME_RE.match(n):
        raise ValueError("Tên tiến trình không hợp lệ (chỉ chữ/số/khoảng trắng/. _ ( ) -, tối đa 64 ký tự).")
    if not n.lower().endswith(".exe"):
        n += ".exe"
    if n.lower() in protected_processes():
        raise ValueError(f"'{n}' là tiến trình được bảo vệ (hệ điều hành hoặc chính Iris) — từ chối.")
    return n
