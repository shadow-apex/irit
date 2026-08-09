"""
tools/mouse_control.py

Cong cu dieu khien con tro chuot theo toa do (x, y) tren man hinh.
Dung chung thu vien pyautogui da co san trong tools/requirements.txt
(pyautogui da duoc cai de phuc vu ai_vision.py, setup_work_mode...).

Duong di chuyen chuot dung DUNG thuat toan "duong cong Bezier + toc do
ngau nhien" ma sidecar/mouse_controller.py va reponew/toado/api_server.py
(OmniParser click server) dang dung — de con tro di chuyen tu nhien giong
nguoi that thay vi mot duong thang cung nhac "day", va de 3 noi nay chuyen
dong GIONG HET NHAU (khong bi lo la 2 kieu di chuyen khac nhau tren cung
1 may).

Vi du dung:
    python tools/mouse_control.py move 800 400
    python tools/mouse_control.py move 800 400 --click
    python tools/mouse_control.py move 800 400 --click --button right
    python tools/mouse_control.py move 800 400 --linear --duration 0.1
    python tools/mouse_control.py click 800 400
    python tools/mouse_control.py click 800 400 --button right
    python tools/mouse_control.py click 800 400 --double
    python tools/mouse_control.py drag 200 200 900 600
    python tools/mouse_control.py scroll -500
    python tools/mouse_control.py position
"""
import sys
import io
import json
import time
import random
import argparse

# Dam bao in tieng Viet khong bi loi tren Windows console (giong cac tool khac)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import pyautogui
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "Thieu thu vien pyautogui. Chay: pip install -r tools/requirements.txt"
    }))
    sys.exit(1)

# An toan: neu con tro bi day vao goc tren-trai man hinh, pyautogui se raise
# FailSafeException va dung ngay lap tuc — tranh chuot chay loan khong kiem
# soat duoc. Giu mac dinh True (khac voi sidecar/mouse_controller.py va
# api_server.py von tat de phuc vu auto-click lien tuc khong nguoi giam sat).
pyautogui.FAILSAFE = True


def _clamp_to_screen(x, y):
    """Gioi han toa do trong pham vi man hinh de tranh loi khi nguoi dung
    nhap toa do ngoai man hinh (vi du am hoac lon hon do phan giai)."""
    screen_w, screen_h = pyautogui.size()
    cx = max(0, min(screen_w - 1, x))
    cy = max(0, min(screen_h - 1, y))
    return cx, cy


def _bezier_path(start, end, n_points=30, control_offset_ratio=0.25):
    """Duong cong Bezier bac 2 giua 2 diem, voi diem dieu khien lech ngau
    nhien sang 1 ben — de con tro luon theo mot duong hoi cong thay vi mot
    duong thang tuyet doi (dau hieu de nhan biet la bot). Giong het ham cung
    ten trong sidecar/mouse_controller.py va reponew/toado/api_server.py."""
    sx, sy = start
    ex, ey = end
    mx, my = (sx + ex) / 2.0, (sy + ey) / 2.0

    dist = max(1.0, ((ex - sx) ** 2 + (ey - sy) ** 2) ** 0.5)
    dx, dy = ex - sx, ey - sy
    perp_x, perp_y = -dy, dx
    norm = max(1e-6, (perp_x ** 2 + perp_y ** 2) ** 0.5)
    perp_x, perp_y = perp_x / norm, perp_y / norm

    offset = dist * control_offset_ratio * random.uniform(0.3, 1.0) * random.choice([-1, 1])
    cx, cy = mx + perp_x * offset, my + perp_y * offset

    points = []
    for i in range(n_points + 1):
        t = i / n_points
        x = (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * ex
        y = (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ey
        points.append((x, y))
    return points


def _smooth_move_to(cx, cy, duration=None):
    """Di chuyen con tro toi (cx, cy) theo duong cong Bezier, toc do hoi
    ngau nhien moi lan goi — tu nhien hon pyautogui.moveTo() thang mot mach.
    Neu duration=None thi tu chon ngau nhien 0.35-0.65s giong OmniParser."""
    start_x, start_y = pyautogui.position()
    path = _bezier_path((start_x, start_y), (cx, cy), n_points=30)
    total_duration = duration if duration is not None else random.uniform(0.35, 0.65)
    step_delay = total_duration / len(path) if len(path) else 0
    for px, py in path:
        pyautogui.moveTo(px, py, duration=0)
        if step_delay:
            time.sleep(step_delay)


def move(x, y, duration=None, linear=False, do_click=False, button="left", double=False):
    """Di chuyen con tro chuot den toa do (x, y). Mac dinh di chuyen mem
    (duong cong Bezier); --linear de di chuyen thang, tuc thi (vi du can
    dinh vi chinh xac tuyet doi cho automation/testing). Neu do_click=True,
    click luon tai diem den (khong can goi lenh 'click' rieng)."""
    cx, cy = _clamp_to_screen(x, y)
    if linear:
        pyautogui.moveTo(cx, cy, duration=duration if duration is not None else 0.2)
    else:
        _smooth_move_to(cx, cy, duration)

    result = {"success": True, "action": "move", "x": cx, "y": cy}

    if do_click:
        # Dung dau tren de "ngam" truoc khi click, giong nguoi that.
        time.sleep(random.uniform(0.05, 0.15))
        if double:
            pyautogui.doubleClick(button=button)
        else:
            pyautogui.click(button=button)
        result["clicked"] = True
        result["button"] = button
        result["double"] = double

    print(json.dumps(result))


def click(x, y, button="left", double=False, linear=False, duration=None):
    """Di chuyen mem den (x, y) roi click (trai/phai/giua), co the double-click."""
    cx, cy = _clamp_to_screen(x, y)
    if linear:
        pyautogui.moveTo(cx, cy, duration=duration if duration is not None else 0.2)
    else:
        _smooth_move_to(cx, cy, duration)

    time.sleep(random.uniform(0.05, 0.15))
    if double:
        pyautogui.doubleClick(button=button)
    else:
        pyautogui.click(button=button)

    print(json.dumps({
        "success": True,
        "action": "double_click" if double else "click",
        "button": button,
        "x": cx,
        "y": cy,
    }))


def drag(x1, y1, x2, y2, duration=0.5, button="left"):
    """Di chuyen mem den (x1, y1), nhan giu nut chuot, keo theo duong cong
    Bezier toi (x2, y2) roi tha ra — dung de keo-tha cua so, file, thanh
    truot... Muot hon dragTo() thang mot mach cua pyautogui."""
    sx, sy = _clamp_to_screen(x1, y1)
    ex, ey = _clamp_to_screen(x2, y2)

    _smooth_move_to(sx, sy, duration=0.3)
    pyautogui.mouseDown(button=button)
    try:
        path = _bezier_path((sx, sy), (ex, ey), n_points=30, control_offset_ratio=0.15)
        step_delay = duration / len(path) if len(path) else 0
        for px, py in path:
            pyautogui.moveTo(px, py, duration=0)
            if step_delay:
                time.sleep(step_delay)
    finally:
        pyautogui.mouseUp(button=button)

    print(json.dumps({
        "success": True,
        "action": "drag",
        "from": {"x": sx, "y": sy},
        "to": {"x": ex, "y": ey},
    }))


def scroll(amount):
    """Cuon chuot tai vi tri hien tai. amount > 0: cuon len, < 0: cuon xuong."""
    pyautogui.scroll(amount)
    print(json.dumps({"success": True, "action": "scroll", "amount": amount}))


def position():
    """In ra vi tri hien tai cua con tro chuot."""
    x, y = pyautogui.position()
    print(json.dumps({"success": True, "action": "position", "x": x, "y": y}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cong cu dieu khien con tro chuot theo toa do")
    sub = parser.add_subparsers(dest="command", required=True)

    p_move = sub.add_parser("move", help="Di chuyen chuot den toa do (x, y), co the click luon")
    p_move.add_argument("x", type=int)
    p_move.add_argument("y", type=int)
    p_move.add_argument("--duration", type=float, default=None, help="Thoi gian di chuyen (giay). Mac dinh: ngau nhien 0.35-0.65s (muot).")
    p_move.add_argument("--linear", action="store_true", help="Di chuyen thang, tuc thi thay vi duong cong mem")
    p_move.add_argument("--click", dest="do_click", action="store_true", help="Click luon sau khi den noi (khong can goi lenh 'click' rieng)")
    p_move.add_argument("--button", choices=["left", "right", "middle"], default="left", help="Dung voi --click")
    p_move.add_argument("--double", action="store_true", help="Double click, dung voi --click")

    p_click = sub.add_parser("click", help="Di chuyen mem den (x, y) va click")
    p_click.add_argument("x", type=int)
    p_click.add_argument("y", type=int)
    p_click.add_argument("--button", choices=["left", "right", "middle"], default="left")
    p_click.add_argument("--double", action="store_true", help="Double click thay vi click don")
    p_click.add_argument("--linear", action="store_true", help="Di chuyen thang, tuc thi thay vi duong cong mem")
    p_click.add_argument("--duration", type=float, default=None)

    p_drag = sub.add_parser("drag", help="Keo chuot tu (x1, y1) den (x2, y2) theo duong cong mem")
    p_drag.add_argument("x1", type=int)
    p_drag.add_argument("y1", type=int)
    p_drag.add_argument("x2", type=int)
    p_drag.add_argument("y2", type=int)
    p_drag.add_argument("--duration", type=float, default=0.5)
    p_drag.add_argument("--button", choices=["left", "right", "middle"], default="left")

    p_scroll = sub.add_parser("scroll", help="Cuon chuot tai vi tri hien tai")
    p_scroll.add_argument("amount", type=int, help="So duong: cuon len, so am: cuon xuong")

    sub.add_parser("position", help="Lay toa do hien tai cua con tro chuot")

    args = parser.parse_args()

    try:
        if args.command == "move":
            move(args.x, args.y, args.duration, args.linear, args.do_click, args.button, args.double)
        elif args.command == "click":
            click(args.x, args.y, args.button, args.double, args.linear, args.duration)
        elif args.command == "drag":
            drag(args.x1, args.y1, args.x2, args.y2, args.duration, args.button)
        elif args.command == "scroll":
            scroll(args.amount)
        elif args.command == "position":
            position()
    except pyautogui.FailSafeException:
        print(json.dumps({
            "success": False,
            "error": "Da huy vi con tro bi day vao goc man hinh (fail-safe cua pyautogui)."
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
