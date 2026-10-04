"""
tools/mouse_control.py — điều khiển con trỏ chuột theo toạ độ pixel VẬT LÝ.

    python tools/mouse_control.py move 800 400 [--click] [--button right] [--double] [--fast] [--linear]
    python tools/mouse_control.py click 800 400 [--fast] [--button right] [--double]
    python tools/mouse_control.py drag 200 200 900 600 [--fast]
    python tools/mouse_control.py scroll -500
    python tools/mouse_control.py position
    python tools/mouse_control.py release            # nhả mọi nút chuột (dọn dẹp sau khi bị huỷ giữa chừng)
    ... --monitor N   (toạ độ TƯƠNG ĐỐI màn hình N theo thứ tự của multi_monitor_info.py, bắt đầu từ 0)

Sửa so với bản cũ:
 * TL-04a: pyautogui.PAUSE = 0 (mặc định 0,1 s sau MỖI lệnh làm đường Bezier 31 bước mất ≥ 3 s).
 * TL-04b/c: nút chuột luôn được nhả (kể cả khi FailSafe nổ giữa chừng); lệnh `release` để Node dọn
   dẹp khi tiến trình bị giết (TerminateProcess không chạy `finally`); đường đi KẸP trong màn hình ảo
   và né góc kích hoạt fail-safe.
 * TL-04d: toạ độ thực (123.5) được làm tròn thay vì làm argparse lỗi.
 * TL-05: kẹp theo MÀN HÌNH ẢO (mọi màn hình), không còn ép vào mép màn hình chính.
"""
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_FAST_TOTAL, _FAST_POINTS, _FAST_PRE_CLICK = 0.05, 10, 0.02
_NORMAL_MIN, _NORMAL_MAX, _NORMAL_POINTS = 0.35, 0.65, 30
_PRE_CLICK_MIN, _PRE_CLICK_MAX = 0.05, 0.15
FAILSAFE_MARGIN = 3


# --------------------------------------------------------------------- hàm thuần (test được)
def to_int(value):
    """Chấp nhận '123', '123.5', '-5' ⇒ int làm tròn."""
    return int(round(float(value)))


def clamp_point(x, y, bounds):
    """bounds = (left, top, right, bottom) bao gồm biên."""
    l, t, r, b = bounds
    return max(l, min(r, int(x))), max(t, min(b, int(y)))


def avoid_failsafe(x, y, bounds, margin=FAILSAFE_MARGIN):
    """Đẩy điểm ra khỏi 4 góc của màn hình ảo và điểm (0,0) (fail-safe mặc định của pyautogui)."""
    l, t, r, b = bounds
    mid_x, mid_y = (l + r) / 2.0, (t + b) / 2.0
    for cx, cy in ((l, t), (r, t), (l, b), (r, b), (0, 0)):
        if abs(x - cx) <= margin and abs(y - cy) <= margin:
            sx = 1 if cx <= mid_x else -1
            sy = 1 if cy <= mid_y else -1
            x, y = cx + sx * (margin + 1), cy + sy * (margin + 1)
    return x, y


def safe_point(x, y, bounds):
    cx, cy = clamp_point(x, y, bounds)
    return avoid_failsafe(cx, cy, bounds)


def resolve_target(x, y, bounds, monitors=None, monitor=None):
    """Đổi toạ độ (tương đối màn hình `monitor` nếu có) về toạ độ tuyệt đối đã kẹp/né góc.

    Trả về (x, y, adjusted:bool).
    """
    x, y = int(x), int(y)
    area = bounds
    if monitor is not None:
        if not monitors or monitor < 0 or monitor >= len(monitors):
            raise ValueError(f"Không có màn hình số {monitor} (có {len(monitors or [])} màn hình).")
        m = monitors[monitor]
        x, y = m["left"] + x, m["top"] + y
        area = (m["left"], m["top"], m["right"] - 1, m["bottom"] - 1)
    sx, sy = clamp_point(x, y, area)
    fx, fy = avoid_failsafe(sx, sy, area)
    return fx, fy, (fx, fy) != (x, y)


def bezier_path(start, end, n_points=30, control_offset_ratio=0.25, rng=random):
    sx, sy = start
    ex, ey = end
    mx, my = (sx + ex) / 2.0, (sy + ey) / 2.0
    dist = max(1.0, ((ex - sx) ** 2 + (ey - sy) ** 2) ** 0.5)
    dx, dy = ex - sx, ey - sy
    px, py = -dy, dx
    norm = max(1e-6, (px ** 2 + py ** 2) ** 0.5)
    px, py = px / norm, py / norm
    offset = dist * control_offset_ratio * rng.uniform(0.3, 1.0) * rng.choice([-1, 1])
    cx, cy = mx + px * offset, my + py * offset
    pts = []
    for i in range(n_points + 1):
        t = i / n_points
        pts.append(((1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * ex,
                    (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ey))
    return pts


def safe_path(start, end, bounds, n_points=30, control_offset_ratio=0.25, rng=random):
    """Đường Bezier mà MỌI điểm đều nằm trong màn hình ảo và không chạm góc fail-safe."""
    return [safe_point(round(x), round(y), bounds) for x, y in
            bezier_path(start, end, n_points, control_offset_ratio, rng)]


# --------------------------------------------------------------------- phần dùng pyautogui (Windows)
_pg_mod = None


def _pg():
    global _pg_mod
    if _pg_mod is None:
        _common.dpi_aware()  # phải TRƯỚC khi pyautogui đọc kích thước màn hình
        pg = _common.require("pyautogui")
        pg.PAUSE = 0
        pg.MINIMUM_DURATION = 0
        pg.MINIMUM_SLEEP = 0
        pg.FAILSAFE = True  # vẫn giữ nút hoảng loạn: đẩy chuột vào góc (0,0) để dừng
        _pg_mod = pg
    return _pg_mod


def virtual_bounds():
    try:
        import ctypes

        u = ctypes.windll.user32
        l, t = u.GetSystemMetrics(76), u.GetSystemMetrics(77)      # SM_X/YVIRTUALSCREEN
        w, h = u.GetSystemMetrics(78), u.GetSystemMetrics(79)      # SM_CX/CYVIRTUALSCREEN
        if w > 0 and h > 0:
            return (l, t, l + w - 1, t + h - 1)
    except Exception:
        pass
    w, h = _pg().size()
    return (0, 0, w - 1, h - 1)


def _monitors():
    import multi_monitor_info

    return multi_monitor_info.get_monitors()["monitors"]


def release_all():
    """Nhả cả 3 nút (tắt fail-safe tạm thời để việc nhả không bị chặn)."""
    pg = _pg()
    old = pg.FAILSAFE
    pg.FAILSAFE = False
    try:
        for b in ("left", "right", "middle"):
            try:
                pg.mouseUp(button=b)
            except Exception:
                pass
    finally:
        pg.FAILSAFE = old


def _follow(path, total_duration):
    pg = _pg()
    delay = total_duration / len(path) if path else 0
    for px, py in path:
        pg.moveTo(px, py, duration=0)
        if delay > 0:
            time.sleep(delay)


def _move_to(cx, cy, bounds, duration=None, fast=False, linear=False):
    pg = _pg()
    if linear:
        pg.moveTo(cx, cy, duration=duration if duration is not None else 0.0 if fast else 0.2)
        return
    start = tuple(pg.position())
    n = _FAST_POINTS if fast else _NORMAL_POINTS
    total = _FAST_TOTAL if fast else (duration if duration is not None else random.uniform(_NORMAL_MIN, _NORMAL_MAX))
    _follow(safe_path(start, (cx, cy), bounds, n), total)


def _target(args, x, y, bounds):
    mons = _monitors() if getattr(args, "monitor", None) is not None else None
    return resolve_target(x, y, bounds, mons, getattr(args, "monitor", None))


def _pre_click(fast):
    time.sleep(_FAST_PRE_CLICK if fast else random.uniform(_PRE_CLICK_MIN, _PRE_CLICK_MAX))


def cmd_move(a):
    bounds = virtual_bounds()
    cx, cy, adjusted = _target(a, a.x, a.y, bounds)
    _move_to(cx, cy, bounds, a.duration, a.fast_mode, a.linear)
    res = {"action": "move", "x": cx, "y": cy, "fast_mode": a.fast_mode, "adjusted": adjusted}
    if a.do_click:
        _pre_click(a.fast_mode)
        (_pg().doubleClick if a.double else _pg().click)(button=a.button)
        res.update(clicked=True, button=a.button, double=a.double)
    _common.emit(True, **res)


def cmd_click(a):
    bounds = virtual_bounds()
    cx, cy, adjusted = _target(a, a.x, a.y, bounds)
    _move_to(cx, cy, bounds, a.duration, a.fast_mode, a.linear)
    _pre_click(a.fast_mode)
    (_pg().doubleClick if a.double else _pg().click)(button=a.button)
    _common.emit(True, action="double_click" if a.double else "click", button=a.button,
                 x=cx, y=cy, fast_mode=a.fast_mode, adjusted=adjusted)


def cmd_drag(a):
    pg = _pg()
    bounds = virtual_bounds()
    sx, sy, adj1 = _target(a, a.x1, a.y1, bounds)
    ex, ey, adj2 = _target(a, a.x2, a.y2, bounds)
    _move_to(sx, sy, bounds, 0.03 if a.fast_mode else 0.3, a.fast_mode)
    pg.mouseDown(button=a.button)
    try:
        n = _FAST_POINTS if a.fast_mode else _NORMAL_POINTS
        _follow(safe_path((sx, sy), (ex, ey), bounds, n, 0.15), 0.1 if a.fast_mode else a.duration)
    finally:
        release_all()  # luôn nhả, kể cả khi FailSafe nổ giữa chừng
    _common.emit(True, action="drag", **{"from": {"x": sx, "y": sy}, "to": {"x": ex, "y": ey}},
                 fast_mode=a.fast_mode, adjusted=adj1 or adj2)


def build_parser():
    p = _common.ArgParser(description="Điều khiển con trỏ chuột theo toạ độ")
    sub = p.add_subparsers(dest="command", required=True)

    def common_opts(sp):
        sp.add_argument("--button", choices=["left", "right", "middle"], default="left")
        sp.add_argument("--monitor", type=to_int, default=None,
                        help="toạ độ tương đối màn hình N (thứ tự trong multi_monitor_info)")
        sp.add_argument("--fast", dest="fast_mode", action="store_true")

    pm = sub.add_parser("move")
    pm.add_argument("x", type=to_int)
    pm.add_argument("y", type=to_int)
    pm.add_argument("--duration", type=float, default=None)
    pm.add_argument("--linear", action="store_true")
    pm.add_argument("--click", dest="do_click", action="store_true")
    pm.add_argument("--double", action="store_true")
    common_opts(pm)

    pc = sub.add_parser("click")
    pc.add_argument("x", type=to_int)
    pc.add_argument("y", type=to_int)
    pc.add_argument("--double", action="store_true")
    pc.add_argument("--linear", action="store_true")
    pc.add_argument("--duration", type=float, default=None)
    common_opts(pc)

    pd = sub.add_parser("drag")
    for n in ("x1", "y1", "x2", "y2"):
        pd.add_argument(n, type=to_int)
    pd.add_argument("--duration", type=float, default=0.5)
    common_opts(pd)

    ps = sub.add_parser("scroll")
    ps.add_argument("amount", type=to_int)
    sub.add_parser("position")
    sub.add_parser("release")
    return p


def main(argv=None):
    a = build_parser().parse_args(argv)
    pg_exc = None
    try:
        pg = _pg()
        pg_exc = pg.FailSafeException
        if a.command == "move":
            cmd_move(a)
        elif a.command == "click":
            cmd_click(a)
        elif a.command == "drag":
            cmd_drag(a)
        elif a.command == "scroll":
            pg.scroll(a.amount)
            _common.emit(True, action="scroll", amount=a.amount)
        elif a.command == "position":
            x, y = pg.position()
            _common.emit(True, action="position", x=x, y=y)
        elif a.command == "release":
            release_all()
            _common.emit(True, action="release", message="Đã nhả mọi nút chuột.")
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        try:
            release_all()
        except Exception:
            pass
        if pg_exc is not None and isinstance(e, pg_exc):
            _common.fail("Đã huỷ vì con trỏ bị đẩy vào góc màn hình (fail-safe của pyautogui).")
        _common.fail(str(e))


if __name__ == "__main__":
    _common.ensure_utf8()
    main()
