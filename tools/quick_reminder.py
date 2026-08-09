"""
tools/quick_reminder.py

Dat nhac viec 1 lan sau N phut (khac notifier.py von bao NGAY LAP TUC).
Lenh 'schedule' tu tach thanh 1 tien trinh nen (detach, khong giu tien
trinh Electron cha cho), ngu den dung gio roi bat thong bao Windows bang
plyer (da co san trong requirements.txt).

Vi du dung:
    python tools/quick_reminder.py schedule --minutes 10 --title "Nghi giai lao" --message "Da lam 50 phut roi, nghi 5 phut nhe!"
    python tools/quick_reminder.py list
    python tools/quick_reminder.py cancel <id>
"""
import sys
import io
import os
import json
import time
import uuid
import tempfile
import argparse
import subprocess

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

STORE_PATH = os.path.join(tempfile.gettempdir(), "iris_reminders.json")


def _load():
    if not os.path.exists(STORE_PATH):
        return []
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(items):
    with open(STORE_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def _fire_now(title, message):
    """Chay TRONG tien trinh nen da tach: bat thong bao ngay khi den gio."""
    try:
        from plyer import notification
        notification.notify(title=title, message=message, app_name="Antigravity AI", timeout=15)
    except Exception:
        pass


def schedule(minutes, title, message):
    if minutes <= 0:
        return {"success": False, "error": "So phut phai lon hon 0."}
    reminder_id = uuid.uuid4().hex[:8]
    target_ts = time.time() + minutes * 60

    items = _load()
    items.append({"id": reminder_id, "title": title, "message": message, "target_ts": target_ts})
    _save(items)

    # Tu goi lai chinh script nay o che do noi bo '_wait' trong 1 tien
    # trinh da tach (khong giu tien trinh cha cho) — giong pattern detach
    # cua magic_move.py --active.
    script_path = os.path.abspath(__file__)
    kwargs = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
    subprocess.Popen(
        [sys.executable, script_path, "_wait", reminder_id],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        **kwargs,
    )

    return {"success": True, "id": reminder_id, "fires_in_minutes": minutes, "message": f"Da dat nhac '{title}' sau {minutes} phut."}


def _wait_and_fire(reminder_id):
    items = _load()
    entry = next((it for it in items if it["id"] == reminder_id), None)
    if not entry:
        return
    delay = entry["target_ts"] - time.time()
    if delay > 0:
        time.sleep(delay)
    # Doc lai file phong khi bi 'cancel' trong luc cho
    items = _load()
    entry = next((it for it in items if it["id"] == reminder_id), None)
    if not entry:
        return  # da bi huy
    _fire_now(entry["title"], entry["message"])
    items = [it for it in items if it["id"] != reminder_id]
    _save(items)


def list_reminders():
    items = _load()
    now = time.time()
    return {"success": True, "reminders": [
        {"id": it["id"], "title": it["title"], "message": it["message"], "fires_in_seconds": max(0, round(it["target_ts"] - now))}
        for it in items
    ]}


def cancel(reminder_id):
    items = _load()
    new_items = [it for it in items if it["id"] != reminder_id]
    if len(new_items) == len(items):
        return {"success": False, "error": f"Khong tim thay nhac viec id={reminder_id}."}
    _save(new_items)
    return {"success": True, "message": f"Da huy nhac viec {reminder_id}."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dat nhac viec 1 lan sau N phut")
    sub = parser.add_subparsers(dest="command", required=True)

    p_sched = sub.add_parser("schedule", help="Dat nhac viec moi")
    p_sched.add_argument("--minutes", type=float, required=True)
    p_sched.add_argument("--title", type=str, required=True)
    p_sched.add_argument("--message", type=str, required=True)

    sub.add_parser("list", help="Liet ke nhac viec dang cho")

    p_cancel = sub.add_parser("cancel", help="Huy 1 nhac viec")
    p_cancel.add_argument("id", type=str)

    # Lenh noi bo, KHONG danh cho nguoi dung goi truc tiep — chi de tien
    # trinh nen tu goi lai chinh no sau khi tach khoi 'schedule'.
    p_wait = sub.add_parser("_wait", help=argparse.SUPPRESS)
    p_wait.add_argument("id", type=str)

    args = parser.parse_args()
    if args.command == "schedule":
        print(json.dumps(schedule(args.minutes, args.title, args.message), ensure_ascii=False))
    elif args.command == "list":
        print(json.dumps(list_reminders(), ensure_ascii=False))
    elif args.command == "cancel":
        print(json.dumps(cancel(args.id), ensure_ascii=False))
    elif args.command == "_wait":
        _wait_and_fire(args.id)
