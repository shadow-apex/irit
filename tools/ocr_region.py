"""
tools/ocr_region.py — OCR một vùng màn hình (hoặc toàn màn hình) bằng Windows Native OCR (winsdk).
Tự động fallback sang pytesseract nếu cần.

    python tools/ocr_region.py [--region L T W H] [--lang vie+eng] [--find text] [--image path]

TL-15: Hỗ trợ Windows Native OCR với tốc độ cực nhanh (~30ms) và trả về tọa độ chính xác của từng từ.
Nếu winsdk không khả dụng, tự động fallback sang Tesseract (đọc TESSERACT_CMD hoặc IRIS_OCR_LANG).
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


def _ocr_with_windows_native(img, region=None, find_text=None):
    """Sử dụng Windows.Media.Ocr qua winsdk (0 external dependencies, siêu tốc ~30ms)."""
    import asyncio
    import winsdk.windows.graphics.imaging as imaging
    import winsdk.windows.media.ocr as ocr
    import winsdk.windows.storage.streams as streams

    offset_x = region[0] if region else 0
    offset_y = region[1] if region else 0

    raw_bytes = img.convert("RGBA").tobytes("raw", "BGRA")
    writer = streams.DataWriter()
    writer.write_bytes(raw_bytes)
    ibuf = writer.detach_buffer()

    sb = imaging.SoftwareBitmap.create_copy_from_buffer(
        ibuf,
        imaging.BitmapPixelFormat.BGRA8,
        img.width,
        img.height,
        imaging.BitmapAlphaMode.PREMULTIPLIED
    )

    engine = ocr.OcrEngine.try_create_from_user_profile_languages()
    if not engine and len(ocr.OcrEngine.available_recognizer_languages) > 0:
        engine = ocr.OcrEngine.try_create_from_language(ocr.OcrEngine.available_recognizer_languages[0])
    if not engine:
        raise RuntimeError("Windows Media OCR Engine không khởi tạo được trên hệ thống.")

    async def _recognize():
        return await engine.recognize_async(sb)

    result = asyncio.run(_recognize())

    words = []
    lines = []
    found_match = None
    target_lower = find_text.strip().lower() if find_text else None

    for line in result.lines:
        line_words = []
        for w in line.words:
            wx = int(round(offset_x + w.bounding_rect.x))
            wy = int(round(offset_y + w.bounding_rect.y))
            ww = int(round(w.bounding_rect.width))
            wh = int(round(w.bounding_rect.height))
            cx = wx + ww // 2
            cy = wy + wh // 2
            word_obj = {
                "text": w.text,
                "x": wx,
                "y": wy,
                "w": ww,
                "h": wh,
                "center": [cx, cy],
            }
            words.append(word_obj)
            line_words.append(word_obj)

            if target_lower and not found_match and target_lower in w.text.lower():
                found_match = {
                    "matched_text": w.text,
                    "center": [cx, cy],
                    "rect": [wx, wy, ww, wh],
                }

        if target_lower and not found_match and target_lower in line.text.lower():
            if line_words:
                lx = min(w["x"] for w in line_words)
                ly = min(w["y"] for w in line_words)
                lw = max(w["x"] + w["w"] for w in line_words) - lx
                lh = max(w["y"] + w["h"] for w in line_words) - ly
                found_match = {
                    "matched_text": line.text,
                    "center": [lx + lw // 2, ly + lh // 2],
                    "rect": [lx, ly, lw, lh],
                }

        lines.append({
            "text": line.text,
            "words": [w["text"] for w in line_words],
        })

    res = {
        "text": result.text.strip(),
        "lines": lines,
        "words": words,
        "word_count": len(words),
        "region": list(region) if region else None,
        "engine": "windows_native",
    }
    if target_lower:
        res["find_query"] = find_text
        res["found"] = bool(found_match)
        if found_match:
            res["center"] = found_match["center"]
            res["rect"] = found_match["rect"]
            res["matched_text"] = found_match["matched_text"]

    return res


def ocr_region(region=None, lang=None, find_text=None, image_path=None):
    _common.dpi_aware()
    from PIL import Image

    if image_path and os.path.isfile(image_path):
        try:
            img = Image.open(image_path)
        except Exception as e:
            _common.fail(f"Không thể mở file ảnh {image_path}: {e}")
    else:
        from PIL import ImageGrab
        try:
            if region:
                l, t, w, h = region
                if w <= 0 or h <= 0:
                    _common.fail("Vùng OCR có chiều rộng/cao không hợp lệ.")
                img = ImageGrab.grab(bbox=(l, t, l + w, t + h), all_screens=True)
            else:
                img = ImageGrab.grab(all_screens=True)
        except Exception as e:
            _common.fail(f"Không chụp được màn hình: {e}")

    # 1. Thử Windows Native OCR trước (nhanh gấp 50 lần, 0 phụ thuộc tesseract.exe)
    try:
        import winsdk.windows.media.ocr  # noqa: F401
        return _ocr_with_windows_native(img, region=region, find_text=find_text)
    except Exception:
        # Nếu Windows Native OCR không khả dụng, tự động fallback sang Tesseract
        pass

    # 2. Fallback sang Tesseract (nếu máy đã cài)
    pytesseract = _common.require("pytesseract")
    cmd = os.environ.get("TESSERACT_CMD")
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
    try:
        available = pytesseract.get_languages(config="")
    except Exception as e:
        msg = str(e).lower()
        if "not installed" in msg or "not in your path" in msg or "no such file" in msg:
            _common.fail("Chưa tìm thấy Tesseract-OCR và Windows Native OCR không khả dụng. "
                         "Vui lòng cài Tesseract từ https://github.com/UB-Mannheim/tesseract/wiki hoặc đặt TESSERACT_CMD.")
        available = []
    chosen, warn = pick_lang(lang, available, os.environ.get("IRIS_OCR_LANG", "").strip())

    nw, nh, factor = downscale_size(*img.size)
    if factor < 1.0:
        img = img.resize((nw, nh))
    try:
        text = pytesseract.image_to_string(img.convert("RGB"), lang=chosen)
    except Exception as e:
        _common.fail(f"Lỗi OCR: {e}")
    res = {
        "text": text.strip(),
        "region": list(region) if region else None,
        "lang": chosen,
        "downscaled": factor < 1.0,
        "engine": "tesseract",
    }
    if warn:
        res["warning"] = warn
    return res


def build_parser():
    p = _common.ArgParser(description="OCR một vùng màn hình bằng Windows Native OCR")
    p.add_argument("--region", type=to_int, nargs=4, metavar=("LEFT", "TOP", "WIDTH", "HEIGHT"))
    p.add_argument("--lang", type=str, default=None)
    p.add_argument("--find", "--find-text", dest="find_text", type=str, default=None, help="Từ khóa cần tìm vị trí trên màn hình")
    p.add_argument("--image", dest="image_path", type=str, default=None, help="Đường dẫn file ảnh (nếu có)")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    _common.emit(True, **ocr_region(a.region, a.lang, find_text=a.find_text, image_path=a.image_path))
