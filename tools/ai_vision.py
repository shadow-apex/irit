"""
tools/ai_vision.py

Chup anh man hinh va luu vao thu muc tools/img de AI (Gemini) "nhin thay"
man hinh nguoi dung.

FIX (2026):
  - RO RI DUNG LUONG DIA: ban truoc day luu 1 file .png MOI moi lan goi va
    KHONG BAO GIO xoa file cu -> thu muc tools/img phinh to vo han neu
    tinh nang nay duoc goi nhieu lan (vd nguoi dung hoi "nhin man hinh gium
    minh" nhieu lan trong ngay). Nay tu dong don dep, chi giu lai
    MAX_SCREENSHOTS anh moi nhat, xoa cac anh cu hon.
  - Chuyen sang in JSON o cuoi (giong moi tool khac) thay vi de
    electron/main/local-tools.mjs phai regex-parse text tieng Viet tu
    stdout — de vo, thay doi cau chu la gay loi ngam.
  - Them try/except o __main__ de khong crash "cam" (khong in duoc gi).

Vi du dung:
    python tools/ai_vision.py --outdir tools/img
"""
import pyautogui
import os
import glob
import json
import argparse
from datetime import datetime
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

# So anh chup man hinh gan nhat duoc giu lai trong thu muc luu — cac anh cu
# hon se bi xoa moi lan chup anh moi, tranh phinh to dung luong dia vo han.
MAX_SCREENSHOTS = 20


def _cleanup_old_screenshots(output_dir, keep=MAX_SCREENSHOTS):
    try:
        files = sorted(
            glob.glob(os.path.join(output_dir, "screenshot_*.png")),
            key=os.path.getmtime,
            reverse=True,
        )
        for old_file in files[keep:]:
            try:
                os.remove(old_file)
            except OSError:
                pass  # file dang bi tool khac mo (vd image_viewer.py) — bo qua, don lan sau
    except Exception:
        pass  # don dep la "best-effort", khong duoc lam hong lan chup anh chinh


def take_screenshot(output_dir=None):
    if output_dir is None or output_dir == ".":
        output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img")

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"screenshot_{timestamp}.png"
    filepath = os.path.abspath(os.path.join(output_dir, filename))

    screenshot = pyautogui.screenshot()
    screenshot.save(filepath)

    _cleanup_old_screenshots(output_dir)

    return {"success": True, "message": f"Da luu anh man hinh tai: {filepath}", "screenshot_path": filepath}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cong cu Con mat AI (Chup anh man hinh)")
    parser.add_argument("--outdir", type=str, help="Thu muc luu anh", default=".")
    args = parser.parse_args()

    try:
        result = take_screenshot(args.outdir)
    except Exception as e:
        result = {"success": False, "error": str(e)}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)
