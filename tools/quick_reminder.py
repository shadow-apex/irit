"""
tools/quick_reminder.py

Dat nhac viec 1 lan sau N phut (khac notifier.py von bao NGAY LAP TUC).
Lenh 'schedule' tu tach thanh 1 tien trinh nen (detach, khong giu tien
trinh Electron cha cho), ngu den dung gio roi bat thong bao Windows bang
plyer (da co san trong requirements.txt).

FIX (2026) — RACE CONDITION: STORE_PATH la 1 file JSON dung CHUNG boi
nhieu tien trinh cung luc (moi lan nguoi dung 'schedule' se co 1 tien
trinh nen '_wait' rieng, cong voi cac lenh 'list'/'cancel' goi tu Electron
bat cu luc nao). _load() -> sua -> _save() KHONG co khoa (lock) truoc day
=> neu 2 tien trinh doc-sua-ghi gan nhu cung luc (vi du 1 nhac viec vua
'fire' dung luc nguoi dung 'cancel' 1 nhac viec khac), ban ghi sau se GHI
DE len ban ghi truoc, lam mot nhac viec da bi huy "song lai", hoac 1 nhac
viec da bao xong khong bao gio bi xoa khoi danh sach (rac vinh vien). Nay
dung khoa file cap he dieu hanh (msvcrt.locking) de nghiem ngat hoa toan
bo chu ky doc-sua-ghi, va ghi file theo kieu "atomic" (ghi ra file tam roi
os.replace) de tranh file JSON bi hong neu tien trinh bi kill giua chung
luc dang ghi.

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

try:
    import msvcrt
    _HAS_MSVCRT = True
except ImportError:
    _HAS_MSVCRT = False  # khong phai Windows (vd chay unit test tren Linux)

STORE_PATH = os.path.join(tempfile.gettempdir(), "iris_reminders.json")
LOCK_PATH = os.path.join(tempfile.gettempdir(), "iris_reminders.lock")


class _StoreLock:
    """Khoa file cap he dieu hanh de serialize moi chu ky doc-sua-ghi
    STORE_PATH giua cac tien trinh doc lap. Tren Windows dung msvcrt.locking
    (LK_LOCK tu retry noi bo ~10s); neu khong co msvcrt (khong phai Windows)
    thi bo qua khoa (best-effort) thay vi crash toan bo tool."""

    def __enter__(self):
        if not _HAS_MSVCRT:
            self._f = None
            return self
        self._f = open(LOCK_PATH, "a+b")
        deadline = time.time() + 10
        while True:
            try:
                msvcrt.locking(self._f.fileno(), msvcrt.LK_LOCK, 1)
                return self
            except OSError:
                if time.time() > deadline:
                    self._f.close()
                    raise TimeoutError("Khong lay duoc khoa file nhac viec (bi tranh chap qua lau).")
                time.sleep(0.05)

    def __exit__(self, exc_type, exc, tb):
        if self._f is None:
            return
        try:
            self._f.seek(0)
            msvcrt.locking(self._f.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            self._f.close()


def _load():
    if not os.path.exists(STORE_PATH):
        return []
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(items):
    # Ghi "atomic": ghi ra file tam trong CUNG thu muc roi os.replace() ghi
    # de len file that — tranh truong hop tien trinh bi kill giua luc dang
    # ghi khien STORE_PATH con lai noi dung JSON hong (nua cu nua moi).
    tmp_path = STORE_PATH + f".tmp{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, STORE_PATH)


def _fire_now(title, message):
    """Chay TRONG tien trinh nen da tach: bat thong bao ngay khi den gio."""
    try:
        from plyer import notification
        notification.notify(title=title, message=message, app_name="Iris AI", timeout=15)
    except Exception:
        pass


def schedule(minutes, title, message):
    if minutes <= 0:
        return {"success": False, "error": "So phut phai lon hon 0."}
    reminder_id = uuid.uuid4().hex[:8]
    target_ts = time.time() + minutes * 60

    with _StoreLock():
        items = _load()
        items.append({"id": reminder_id, "title": title, "message": message, "target_ts": target_ts})
        _save(items)

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
    with _StoreLock():
        items = _load()
        entry = next((it for it in items if it["id"] == reminder_id), None)
    if not entry:
        return
    delay = entry["target_ts"] - time.time()
    if delay > 0:
        time.sleep(delay)

    # Doc lai + xoa trong CUNG 1 khoa de tranh 2 tien trinh cung fire/xoa
    # trung nhau, hoac ghi de len 1 'cancel' vua xay ra dung luc nay.
    with _StoreLock():
        items = _load()
        entry = next((it for it in items if it["id"] == reminder_id), None)
        if not entry:
            return  # da bi huy trong luc cho
        items = [it for it in items if it["id"] != reminder_id]
        _save(items)

    _fire_now(entry["title"], entry["message"])


def list_reminders():
    with _StoreLock():
        items = _load()
    now = time.time()
    return {"success": True, "reminders": [
        {"id": it["id"], "title": it["title"], "message": it["message"], "fires_in_seconds": max(0, round(it["target_ts"] - now))}
        for it in items
    ]}


def cancel(reminder_id):
    with _StoreLock():
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
    try:
        if args.command == "schedule":
            print(json.dumps(schedule(args.minutes, args.title, args.message), ensure_ascii=False))
        elif args.command == "list":
            print(json.dumps(list_reminders(), ensure_ascii=False))
        elif args.command == "cancel":
            print(json.dumps(cancel(args.id), ensure_ascii=False))
        elif args.command == "_wait":
            _wait_and_fire(args.id)
    except Exception as e:
        # '_wait' chay ngam khong ai doc stdout nen khong can in gi them,
        # nhung 3 lenh con lai (schedule/list/cancel) LUON phai tra JSON
        # de Electron/AI khong bao gio nhan duoc mot traceback tho.
        if args.command != "_wait":
            print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
            sys.exit(1)
