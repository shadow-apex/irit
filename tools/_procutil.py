"""
tools/_procutil.py — tìm và đóng tiến trình theo tên (dùng chung cho process_manager & system_actions).

Mặc định ĐÓNG ÊM (taskkill không /F ⇒ WM_CLOSE). Chỉ /F khi force=True.
Hàm `classify_close_result` là hàm thuần để test.
"""
import os
import subprocess
import time

from _common import decode_bytes, validate_process_name


def _ancestors():
    pids = {os.getpid()}
    try:
        import psutil

        p = psutil.Process(os.getpid())
        for a in p.parents():
            pids.add(a.pid)
    except Exception:
        pass
    try:
        sp = int(os.environ.get("IRIS_SELF_PID", "0"))
        if sp:
            pids.add(sp)
    except ValueError:
        pass
    return pids


def find_pids(exe_name):
    """PID của mọi tiến trình có tên == exe_name (không phân biệt hoa thường), trừ Iris/tổ tiên."""
    import psutil

    skip = _ancestors()
    want = exe_name.lower()
    out = []
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if (p.info.get("name") or "").lower() == want and p.info["pid"] not in skip:
                out.append(p.info["pid"])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return out


def classify_close_result(matched, still_running, force, errors):
    """Hàm thuần: tóm tắt kết quả thành (success, message)."""
    if matched == 0:
        return False, "Không có tiến trình nào khớp tên này."
    closed = matched - still_running
    if still_running == 0:
        return True, f"Đã {'buộc kết thúc' if force else 'đóng'} {closed}/{matched} tiến trình."
    if not force:
        return False, (f"Đã gửi yêu cầu đóng nhưng còn {still_running}/{matched} tiến trình chạy "
                       "(ứng dụng có thể đang hỏi lưu dữ liệu hoặc không có cửa sổ). "
                       "Chỉ khi người dùng đồng ý mất dữ liệu chưa lưu mới gọi lại với force=true.")
    return False, f"Không thể kết thúc {still_running}/{matched} tiến trình (thiếu quyền?). {errors[:1]}"


def close_processes(name, force=False):
    """Đóng mọi instance của `name`. Trả về dict kết quả (không ném lỗi, trừ tên không hợp lệ)."""
    exe = validate_process_name(name)
    pids = find_pids(exe)
    errors = []
    for pid in pids:
        cmd = ["taskkill", "/PID", str(pid)] + (["/F"] if force else [])
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode != 0:
            errors.append(decode_bytes(r.stderr or r.stdout).strip())
    time.sleep(1.0 if pids else 0)
    alive = set(find_pids(exe))
    remaining = len([p for p in pids if p in alive])
    ok, msg = classify_close_result(len(pids), remaining, force, errors)
    return {"success": ok, "process": exe, "matched": len(pids), "remaining": remaining,
            "forced": bool(force), "message" if ok else "error": msg}
