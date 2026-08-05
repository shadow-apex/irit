import sys
import json
import time
import random
import pyautogui

pyautogui.FAILSAFE = False


def _bezier_path(start, end, n_points=30, control_offset_ratio=0.25):
    """
    Quadratic Bezier path between two points with a randomized control point,
    so the cursor follows a slight curve instead of a straight, robotic line.
    """
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


def move_and_click(x_ratio, y_ratio):
    try:
        screen_width, screen_height = pyautogui.size()
        start_x, start_y = pyautogui.position()

        # Real users never click the exact pixel center every time — add a
        # small random jitter around the target instead of always the same spot.
        target_x = int(float(x_ratio) * screen_width) + random.randint(-3, 3)
        target_y = int(float(y_ratio) * screen_height) + random.randint(-2, 2)
        target_x = max(0, min(screen_width - 1, target_x))
        target_y = max(0, min(screen_height - 1, target_y))

        path = _bezier_path((start_x, start_y), (target_x, target_y), n_points=30)

        # Randomize total travel time on every call — a fixed duration repeated
        # identically every time is itself a giveaway that it's not a human.
        total_duration = random.uniform(0.35, 0.65)
        step_delay = total_duration / len(path)

        for px, py in path:
            pyautogui.moveTo(px, py, duration=0)
            time.sleep(step_delay)

        # Small "aim and settle" pause before clicking, like a human would.
        time.sleep(random.uniform(0.05, 0.15))
        pyautogui.click()

        print(json.dumps({"success": True, "x": target_x, "y": target_y}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Missing coordinates (x_ratio, y_ratio)"}))
        sys.exit(1)

    x = sys.argv[1]
    y = sys.argv[2]
    move_and_click(x, y)
