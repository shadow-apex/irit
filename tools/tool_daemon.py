"""
tools/tool_daemon.py — Persistent Python Tool Daemon (Zero-Spawn Overhead < 5ms).

Giữ tiến trình Python và các thư viện nặng (ctypes, winsdk, PIL, pyautogui, psutil, UIAutomation)
thường trú trong RAM. Nhận yêu cầu thực thi công cụ qua JSON-RPC từng dòng trên stdin và trả về
kết quả tức thì qua stdout mà không tốn 150-300ms khởi tạo lại python.exe cho mỗi bước.
"""
import io
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
_CODE_CACHE = {}
_WARMED = False


def _prewarm_modules():
    """Nạp sẵn các module cốt lõi vào sys.modules để lệnh đầu tiên đạt tốc độ < 5ms."""
    global _WARMED
    if _WARMED:
        return
    _WARMED = True
    _common.dpi_aware()
    for mod_name in (
        "_winutil",
        "active_window_info",
        "mouse_control",
        "ocr_region",
        "move_window",
        "ui_automation",
        "multi_monitor_info",
        "sys_monitor",
        "clipboard_manager",
        "filesystem_ops",
        "window_manager",
        "search_everything",
        "idle_time",
        "color_picker",
    ):
        try:
            __import__(mod_name)
        except Exception:
            pass
    try:
        import psutil

        psutil.cpu_percent(None)
    except Exception:
        pass


def _run_direct_module(script, args):
    """Chạy trực tiếp qua module đã nạp trong RAM để tận dụng tối đa bộ nhớ đệm nội bộ."""
    if script == "active_window_info.py":
        import active_window_info

        try:
            info = active_window_info.get_active_window_info()
        except Exception as e:
            _common.fail(f"Không đọc được cửa sổ đang focus: {e}")
        if info is None:
            _common.emit(
                True,
                title="",
                pid=0,
                process_name=None,
                process_path=None,
                rect={"left": 0, "top": 0, "right": 0, "bottom": 0},
                width=0,
                height=0,
                is_iris=False,
                message="Hiện không có cửa sổ ứng dụng nào đang mở hoặc được chọn.",
            )
        else:
            _common.emit(True, **info)
        return True

    if script == "sys_monitor.py":
        import psutil
        import sys_monitor

        try:
            _common.emit(True, **sys_monitor.collect(psutil, fast=True))
        except Exception as e:
            _common.fail(f"Không đọc được thông số hệ thống: {e}")
        return True

    if script == "idle_time.py":
        import idle_time

        secs = idle_time.get_idle_seconds()
        if secs is None:
            _common.fail("GetLastInputInfo() thất bại.")
        _common.emit(True, idle_seconds=secs)
        return True

    if script == "multi_monitor_info.py":
        import multi_monitor_info

        try:
            _common.emit(True, **multi_monitor_info.get_monitors())
        except Exception as e:
            _common.fail(f"Không liệt kê được màn hình: {e}")
        return True

    if script == "search_everything.py":
        import search_everything

        a = search_everything.build_parser().parse_args(args)
        try:
            payload = search_everything.run_search(a.query, a.max)
            _common.emit(True, **payload)
        except Exception as e:
            _common.fail(str(e))
        return True

    if script == "mouse_control.py":
        import mouse_control

        mouse_control.main(args)
        return True

    if script == "ocr_region.py":
        import ocr_region

        a = ocr_region.build_parser().parse_args(args)
        res = ocr_region.ocr_region(
            a.region,
            a.lang,
            find_text=a.find_text,
            image_path=a.image_path,
            use_cache=not getattr(a, "no_cache", False),
        )
        _common.emit(True, **res)
        return True

    if script == "move_window.py":
        import move_window

        a = move_window.build_parser().parse_args(args)
        try:
            res = move_window.move_window(a.title, a.x, a.y, a.width, a.height)
        except ValueError as e:
            _common.fail(str(e))
        res_copy = dict(res)
        ok = res_copy.pop("success", False)
        _common.emit(ok, **res_copy)
        return True

    if script == "ui_automation.py":
        import ui_automation

        ui_automation.main(args)
        return True

    return False


def execute_tool_in_memory(script, args=None, stdin_text=None):
    """Thực thi một script trong tools/ ngay trong bộ nhớ và trả về dict {ok, code, stdout, stderr, duration_ms}."""
    t0 = time.perf_counter()
    args_list = [str(x) for x in (args or [])]
    script_name = os.path.basename(str(script or ""))
    script_path = os.path.join(_TOOLS_DIR, script_name)

    if not script_name or not os.path.isfile(script_path):
        return {
            "ok": False,
            "code": 1,
            "stdout": "",
            "stderr": f"Không tìm thấy script: {script_name}",
            "duration_ms": 0.0,
        }

    out_buf = io.StringIO()
    err_buf = io.StringIO()
    raw_stdin = stdin_text if isinstance(stdin_text, str) else ""
    in_bytes = io.BytesIO(raw_stdin.encode("utf-8", errors="replace"))
    in_buf = io.TextIOWrapper(in_bytes, encoding="utf-8", errors="replace")

    old_stdout, old_stderr, old_stdin, old_argv = sys.stdout, sys.stderr, sys.stdin, sys.argv
    sys.stdout = out_buf
    sys.stderr = err_buf
    sys.stdin = in_buf
    sys.argv = [script_path, *args_list]
    code = 0

    try:
        handled = _run_direct_module(script_name, args_list)
        if not handled:
            mtime = os.path.getmtime(script_path)
            cached = _CODE_CACHE.get(script_name)
            if not cached or cached[0] != mtime:
                with open(script_path, "r", encoding="utf-8") as f:
                    src = f.read()
                compiled = compile(src, script_path, "exec")
                _CODE_CACHE[script_name] = (mtime, compiled)
            else:
                compiled = cached[1]

            ns = {
                "__name__": "__main__",
                "__file__": script_path,
                "__builtins__": __builtins__,
            }
            exec(compiled, ns)
    except SystemExit as se:
        if se.code is None or se.code is False:
            code = 0
        elif se.code is True:
            code = 1
        elif isinstance(se.code, int):
            code = se.code
        else:
            err_buf.write(str(se.code) + "\n")
            code = 1
    except Exception as exc:
        err_buf.write(f"{type(exc).__name__}: {exc}\n")
        code = 1
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        sys.stdin = old_stdin
        sys.argv = old_argv

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    stdout_str = out_buf.getvalue().strip()
    stderr_str = err_buf.getvalue().strip()
    return {
        "ok": code == 0,
        "code": code,
        "stdout": stdout_str,
        "stderr": stderr_str,
        "duration_ms": elapsed_ms,
    }


def main():
    _common.ensure_utf8()
    _prewarm_modules()
    real_stdin = sys.stdin
    real_stdout = sys.stdout

    while True:
        line = real_stdin.readline()
        if not line:
            break
        raw = line.strip()
        if not raw:
            continue
        if raw == "stop":
            break

        try:
            req = json.loads(raw)
        except Exception as e:
            resp = {"id": None, "ok": False, "code": 1, "stdout": "", "stderr": f"JSON request lỗi: {e}"}
            real_stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            real_stdout.flush()
            continue

        req_id = req.get("id")
        if req.get("ping"):
            real_stdout.write(json.dumps({"id": req_id, "ok": True, "pong": True}) + "\n")
            real_stdout.flush()
            continue

        res = execute_tool_in_memory(
            req.get("script"),
            req.get("args") or [],
            req.get("stdin"),
        )
        res["id"] = req_id
        try:
            real_stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
        except UnicodeEncodeError:
            real_stdout.write(json.dumps(res, ensure_ascii=True) + "\n")
        real_stdout.flush()


if __name__ == "__main__":
    _common.ensure_utf8()
    main()
