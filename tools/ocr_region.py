"""
tools/ocr_region.py

OCR (nhan dang chu) mot vung man hinh chi dinh, hoac toan bo man hinh neu
khong truyen toa do. Dung pytesseract + Pillow (Pillow di kem san voi
pyautogui) de doc chu tu anh chup man hinh, khong can gui ca anh cho
Gemini chi de doc mot dong text.

**YEU CAU CAI DAT THEM (ngoai pip):** Tesseract-OCR engine phai duoc cai
RIENG tren may (day la phan mem, khong phai goi pip):
  https://github.com/UB-Mannheim/tesseract/wiki (ban cai Windows)
Sau khi cai, hoac them thu muc cai dat vao PATH, hoac set bien moi truong
TESSERACT_CMD tro toi tesseract.exe, vi du:
  set TESSERACT_CMD=C:\\Program Files\\Tesseract-OCR\\tesseract.exe

Vi du dung:
    python tools/ocr_region.py                            # OCR toan man hinh
    python tools/ocr_region.py --region 100 100 500 300    # OCR 1 vung (left top width height)
    python tools/ocr_region.py --lang vie                  # OCR tieng Viet (can cai goi ngon ngu vie.traineddata)
"""
import sys
import io
import os
import json
import argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import pyautogui
except ImportError:
    print(json.dumps({"success": False, "error": "Thieu thu vien pyautogui. Chay: pip install -r tools/requirements.txt"}))
    sys.exit(1)

try:
    import pytesseract
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "Thieu thu vien pytesseract. Chay: pip install -r tools/requirements.txt"
    }))
    sys.exit(1)

tesseract_cmd = os.environ.get("TESSERACT_CMD")
if tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd


def ocr_region(region=None, lang="eng"):
    try:
        screenshot = pyautogui.screenshot(region=tuple(region) if region else None)
    except Exception as e:
        return {"success": False, "error": f"Khong chup duoc man hinh: {e}"}

    try:
        text = pytesseract.image_to_string(screenshot, lang=lang)
    except Exception as e:
        msg = str(e)
        if "tesseract is not installed" in msg.lower() or "not in your path" in msg.lower():
            return {
                "success": False,
                "error": (
                    "Chua tim thay Tesseract-OCR engine tren may (day la phan mem rieng, "
                    "khong phai goi pip). Cai tai "
                    "https://github.com/UB-Mannheim/tesseract/wiki roi thu lai, hoac set "
                    "bien moi truong TESSERACT_CMD tro toi tesseract.exe."
                ),
            }
        return {"success": False, "error": f"Loi OCR: {msg}"}

    return {"success": True, "text": text.strip(), "region": region, "lang": lang}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OCR mot vung man hinh")
    parser.add_argument("--region", type=int, nargs=4, metavar=("LEFT", "TOP", "WIDTH", "HEIGHT"),
                         help="Vung can OCR. Bo qua de OCR toan man hinh.")
    parser.add_argument("--lang", type=str, default="eng", help="Ma ngon ngu Tesseract, vd 'eng', 'vie'. Mac dinh 'eng'.")
    args = parser.parse_args()
    print(json.dumps(ocr_region(args.region, args.lang), ensure_ascii=False))
