"""
tools/terminal_executor.py — Thực thi lệnh PowerShell, CMD hoặc Python trực tiếp trên máy tính.

    python tools/terminal_executor.py --shell=powershell|cmd|python [--cwd="..."] [--timeout=30] --stdin

Nhận câu lệnh qua STDIN (hoặc --command) để tránh giới hạn độ dài dòng lệnh và không dùng shell=True.
Bắt đầy đủ stdout, stderr, exit_code và thời gian chạy.
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_OUTPUT_CHARS = 16000


def run_command(shell_type, code, cwd=None, timeout_sec=30):
    if not code or not str(code).strip():
        _common.fail("Thiếu câu lệnh hoặc đoạn mã cần thực thi.")

    work_dir = os.path.expanduser("~")
    if cwd and str(cwd).strip():
        expanded = os.path.expandvars(os.path.expanduser(str(cwd).strip()))
        if not os.path.isdir(expanded):
            _common.fail(f"Thư mục làm việc không tồn tại: {expanded}")
        work_dir = os.path.abspath(expanded)

    timeout_sec = max(1, min(int(timeout_sec or 30), 300))
    shell_type = (shell_type or "powershell").strip().lower()

    if shell_type in ("powershell", "ps", "pwsh"):
        # Ép UTF-8 cho PowerShell output
        wrapped = (
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
            "$OutputEncoding = [System.Text.Encoding]::UTF8; "
            f"{code}"
        )
        cmd_args = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapped]
    elif shell_type in ("cmd", "batch", "bat"):
        cmd_args = ["cmd.exe", "/d", "/s", "/c", f"chcp 65001 >nul & {code}"]
    elif shell_type in ("python", "py"):
        cmd_args = [sys.executable, "-c", code]
    else:
        _common.fail(f"Loại shell không hợp lệ: '{shell_type}'. Hỗ trợ: powershell, cmd, python.")

    start_t = time.time()
    try:
        proc = subprocess.run(
            cmd_args,
            cwd=work_dir,
            capture_output=True,
            timeout=timeout_sec,
            env=dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1"),
        )
        elapsed_ms = int((time.time() - start_t) * 1000)
        stdout_str = _common.decode_bytes(proc.stdout).strip()
        stderr_str = _common.decode_bytes(proc.stderr).strip()

        truncated = False
        if len(stdout_str) > MAX_OUTPUT_CHARS:
            stdout_str = stdout_str[:MAX_OUTPUT_CHARS] + "\n...[đã cắt bớt đầu ra dài]..."
            truncated = True
        if len(stderr_str) > MAX_OUTPUT_CHARS:
            stderr_str = stderr_str[:MAX_OUTPUT_CHARS] + "\n...[đã cắt bớt lỗi dài]..."
            truncated = True

        return {
            "shell": shell_type,
            "cwd": work_dir,
            "exit_code": int(proc.returncode),
            "command_succeeded": proc.returncode == 0,
            "stdout": stdout_str,
            "stderr": stderr_str,
            "truncated": truncated,
            "duration_ms": elapsed_ms,
            "message": (
                f"Đã thực thi lệnh {shell_type} thành công ({elapsed_ms}ms)."
                if proc.returncode == 0
                else f"Lệnh {shell_type} kết thúc với mã lỗi {proc.returncode}."
            ),
        }
    except subprocess.TimeoutExpired as e:
        stdout_part = _common.decode_bytes(e.stdout).strip()[:4000] if e.stdout else ""
        stderr_part = _common.decode_bytes(e.stderr).strip()[:4000] if e.stderr else ""
        _common.fail(
            f"Lệnh chạy quá thời gian ({timeout_sec}s).",
            stdout=stdout_part,
            stderr=stderr_part,
            timed_out=True,
        )
    except Exception as e:
        _common.fail(f"Không thể thực thi lệnh: {e}")


def build_parser():
    p = _common.ArgParser(description="Thực thi lệnh PowerShell, CMD hoặc Python.")
    p.add_argument("--shell", choices=["powershell", "cmd", "python"], default="powershell")
    p.add_argument("--command", default="", help="Câu lệnh cần chạy (hoặc truyền qua --stdin).")
    p.add_argument("--stdin", action="store_true", help="Đọc câu lệnh từ STDIN.")
    p.add_argument("--cwd", default="", help="Thư mục làm việc.")
    p.add_argument("--timeout", type=int, default=30, help="Thời gian chờ tối đa (giây, mặc định 30, tối đa 300).")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    args = build_parser().parse_args()
    code = sys.stdin.read() if args.stdin else args.command
    res = run_command(args.shell, code, cwd=args.cwd, timeout_sec=args.timeout)
    _common.emit(True, **res)
