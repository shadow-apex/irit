"""
tools/ocr_region.py — OCR một vùng màn hình (hoặc toàn màn hình) bằng Windows Native OCR (winsdk).
Tự động fallback sang pytesseract nếu cần.

    python tools/ocr_region.py [--region L T W H] [--lang vie+eng] [--find text] [--image path] [--no-cache]

TL-15: Hỗ trợ Windows Native OCR với tốc độ cực nhanh (~30ms) và trả về tọa độ chính xác của từng từ.
Nếu winsdk không khả dụng, tự động fallback sang Tesseract (đọc TESSERACT_CMD hoặc IRIS_OCR_LANG).
Nâng cấp: Smart Visual Cache so sánh chữ ký ảnh (hash) + timestamp để tái sử dụng kết quả OCR khi màn hình không đổi.
"""
import hashlib
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

MAX_OCR_WIDTH = 2400
OCR_CACHE_TTL_SEC = 5.0
_MEMORY_OCR_CACHE = {}


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


def compute_image_signature(img):
    """Tính chữ ký hình ảnh siêu nhanh (< 0.5ms) bằng cách lấy mẫu thu nhỏ + kích thước gốc."""
    try:
        thumb = img.resize((64, 36)).convert("RGB")
        h = hashlib.sha256()
        h.update(f"{img.width}x{img.height}:".encode("ascii"))
        h.update(thumb.tobytes())
        return h.hexdigest()
    except Exception:
        return None


def find_in_ocr_data(words, lines, find_text):
    """Hàm thuần: tìm tọa độ từ hoặc dòng khớp với `find_text` trên dữ liệu OCR đã trích xuất."""
    if not find_text or not str(find_text).strip():
        return None
    target_lower = str(find_text).strip().lower()

    for w in (words or []):
        w_text = str(w.get("text", ""))
        if target_lower in w_text.lower():
            wx = int(w.get("x", w.get("left", 0)))
            wy = int(w.get("y", w.get("top", 0)))
            ww = int(w.get("w", w.get("width", 0)))
            wh = int(w.get("h", w.get("height", 0)))
            center = w.get("center") or [wx + ww // 2, wy + wh // 2]
            return {
                "matched_text": w_text,
                "center": list(center),
                "rect": [wx, wy, ww, wh],
            }

    for line in (lines or []):
        if isinstance(line, str):
            continue
        l_text = str(line.get("text", ""))
        if target_lower in l_text.lower():
            line_rects = line.get("word_rects")
            if line_rects:
                lx = min(r[0] for r in line_rects)
                ly = min(r[1] for r in line_rects)
                lw = max(r[0] + r[2] for r in line_rects) - lx
                lh = max(r[1] + r[3] for r in line_rects) - ly
                return {
                    "matched_text": l_text,
                    "center": [lx + lw // 2, ly + lh // 2],
                    "rect": [lx, ly, lw, lh],
                }
            lx = int(line.get("x", line.get("left", 0)))
            ly = int(line.get("y", line.get("top", 0)))
            lw = int(line.get("w", line.get("width", 0)))
            lh = int(line.get("h", line.get("height", 0)))
            center = line.get("center") or [lx + lw // 2, ly + lh // 2]
            return {
                "matched_text": l_text,
                "center": list(center),
                "rect": [lx, ly, lw, lh],
            }
    return None


def _apply_find_query(base_res, find_text):
    res = dict(base_res)
    # Không trả word_rects nội bộ ra JSON ngoài nếu không cần thiết
    if "lines" in res:
        res["lines"] = [{"text": ln.get("text", ""), "words": ln.get("words", [])} for ln in res["lines"]]
    if find_text and str(find_text).strip():
        found_match = find_in_ocr_data(base_res.get("words", []), base_res.get("lines", []), find_text)
        res["find_query"] = find_text
        res["found"] = bool(found_match)
        if found_match:
            res["center"] = found_match["center"]
            res["rect"] = found_match["rect"]
            res["matched_text"] = found_match["matched_text"]
    return res


def _cache_file_path():
    return os.path.join(tempfile.gettempdir(), "iris_ocr_visual_cache.json")


def _load_cached_ocr(sig, region_key, ttl_sec=OCR_CACHE_TTL_SEC):
    if not sig:
        return None
    now = time.time()
    mem_entry = _MEMORY_OCR_CACHE.get((sig, region_key))
    if mem_entry and (now - mem_entry["ts"]) <= ttl_sec:
        return mem_entry["data"]

    try:
        p = _cache_file_path()
        if not os.path.isfile(p):
            return None
        with open(p, "r", encoding="utf-8") as f:
            cached = json.load(f)
        if (
            isinstance(cached, dict)
            and cached.get("sig") == sig
            and cached.get("region_key") == list(region_key)
            and (now - float(cached.get("ts", 0))) <= ttl_sec
            and isinstance(cached.get("data"), dict)
        ):
            _MEMORY_OCR_CACHE[(sig, region_key)] = {"ts": float(cached["ts"]), "data": cached["data"]}
            return cached["data"]
    except Exception:
        pass
    return None


def _save_cached_ocr(sig, region_key, data):
    if not sig or not isinstance(data, dict):
        return
    now = time.time()
    _MEMORY_OCR_CACHE[(sig, region_key)] = {"ts": now, "data": data}
    try:
        p = _cache_file_path()
        tmp = f"{p}.{os.getpid()}.tmp"
        payload = {"sig": sig, "region_key": list(region_key), "ts": now, "data": data}
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, p)
    except Exception:
        pass


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

    for line in result.lines:
        line_words = []
        line_rects = []
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
            line_rects.append([wx, wy, ww, wh])

        lines.append({
            "text": line.text,
            "words": [w["text"] for w in line_words],
            "word_rects": line_rects,
        })

    base_res = {
        "text": result.text.strip(),
        "lines": lines,
        "words": words,
        "word_count": len(words),
        "region": list(region) if region else None,
        "engine": "windows_native",
    }
    return base_res


def ocr_region(region=None, lang=None, find_text=None, image_path=None, use_cache=True):
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

    region_key = tuple(region) if region else ()
    sig = compute_image_signature(img) if use_cache else None

    if use_cache and sig:
        cached_base = _load_cached_ocr(sig, region_key)
        if cached_base is not None:
            out = _apply_find_query(cached_base, find_text)
            out["cached"] = True
            return out

    # 1. Thử Windows Native OCR trước (nhanh gấp 50 lần, 0 phụ thuộc tesseract.exe)
    try:
        import winsdk.windows.media.ocr  # noqa: F401
        base_res = _ocr_with_windows_native(img, region=region, find_text=find_text)
        if use_cache and sig:
            _save_cached_ocr(sig, region_key, base_res)
        out = _apply_find_query(base_res, find_text)
        out["cached"] = False
        return out
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
        "cached": False,
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
    p.add_argument("--no-cache", dest="no_cache", action="store_true", help="Bỏ qua bộ nhớ đệm OCR")
    return p


if __name__ == "__main__":
    _common.ensure_utf8()
    a = build_parser().parse_args()
    _common.emit(True, **ocr_region(a.region, a.lang, find_text=a.find_text, image_path=a.image_path, use_cache=not a.no_cache))
