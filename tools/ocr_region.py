"""
tools/ocr_region.py — OCR một vùng màn hình (hoặc toàn màn hình) bằng pytesseract.

    python tools/ocr_region.py [--region L T W H] [--lang vie+eng]

Cần cài thêm engine Tesseract-OCR riêng (https://github.com/UB-Mannheim/tesseract/wiki) — đặt
TESSERACT_CMD nếu không có trong PATH.

TL-15: ngôn ngữ mặc định lấy từ IRIS_OCR_LANG; nếu không đặt, dùng `vie+eng` khi Tesseract có gói
`vie`, ngược lại `eng` kèm cảnh báo. Vùng quá lớn được thu nhỏ trước khi OCR. Chụp bằng
PIL.ImageGrab(all_screens) nên vùng ở màn hình phụ (toạ độ âm) cũng đọc được.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_OCR_WIDTH = 2400


def to_int(v):
    return int(round(float(v)))


def pick_lang(requested, available, env_lang=""):
    """Hàm thuần: chọn mã ngôn ngữ. Trả về (lang, warning|None)."""
    if requested:
        return requested, None
    if env_lang:
        return env_lang, None
    if "vie" in (available or []):
        return ("vie+eng" if "eng" in available else "vie"), None
    return "eng", "Chưa cài gói ngôn ngữ 'vie' cho Tesseract — văn bản tiếng Việt sẽ đọc sai. Cài vie.traineddata hoặc đặt IRIS_OCR_LANG."


def downscale_size(width, height, max_width=MAX_OCR_WIDTH):
    """Hàm thuần: kích thước sau thu nhỏ (giữ tỉ lệ)."""
    if width <= max_width:
        return width, height, 1.0
    f = max_width / float(width)
    return max(1, int(width * f)), max(1, int(height * f)), f


def ocr_region(region=None, lang=None):
    _common.dpi_aware()
    pytesseract = _common.require("pytesseract")
    from PIL import ImageGrab

    cmd = os.environ.get("TESSERACT_CMD")
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
    try:
        available = pytesseract.get_languages(config="")
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if "not installed" in msg or "not in your path" in msg or "no such file" in msg:
            _common.fail("Chưa tìm thấy Tesseract-OCR (phần mềm riêng, không phải gói pip). Cài từ "
                         "https://github.com/UB-Mannheim/tesseract/wiki hoặc đặt TESSERACT_CMD.")
        available = []
    chosen, warn = pick_lang(lang, available, os.environ.get("IRIS_OCR_LANG", "").strip())

    try:
        if region:
            l, t, w, h = region
            if w <= 0 or h <= 0:
                _common.fail("Vùng OCR có chiều rộng/cao không hợp lệ.")
            img = ImageGrab.grab(bbox=(l, t, l + w, t + h), all_screens=True)
        else:
            img = ImageGrab.grab(all_screens=True)
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Không chụp được màn hình: {e}")
    nw, nh, factor = downscale_size(*img.size)
    if factor < 1.0:
        img = img.resize((nw, nh))
    try:
        text = pytesseract.image_to_string(img.convert("RGB"), lang=chosen)
    except Exception as e:  # noqa: BLE001
        _common.fail(f"Lỗi OCR: {e}")
    res = {"text": text.strip(), "region": list(region) if region else None, "lang": chosen, "downscaled": factor < 1.0}
    if warn:
        res["warning"] = warn
    return res


def build_parser():
    p = _common.ArgParser(description="OCR một vùng màn hình")
    p.add_argument("--region", type=to_int, nargs=4, metavar=("LEFT", "TOP", "WIDTH", "HEIGHT"))
    p.add_argument("--lang", type=str, default=None)
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    _common.emit(True, **ocr_region(a.region, a.lang))
