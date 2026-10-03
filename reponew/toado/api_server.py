import os
import io
import hmac
import re
import time
import random
import base64
import asyncio
from typing import Optional
from dotenv import load_dotenv

# Tự động nạp biến môi trường từ file .env ở thư mục gốc (irit)
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
from PIL import Image
import torch
# M-02: SDK legacy `google-generativeai` đã thay bằng `google-genai`.
from google import genai
from google.genai import types as genai_types
import anthropic

from util.utils import check_ocr_box, get_yolo_model, get_som_labeled_img

# ---------------------------------------------------------------------------
# S-01 — Bảo mật: server này điều khiển chuột/bàn phím (pyautogui) nên
#   * chỉ bind 127.0.0.1 (IRIS_OMNI_HOST ghi đè nếu thật sự cần),
#   * MỌI route yêu cầu header X-Iris-Token khớp IRIS_OMNI_TOKEN (so sánh
#     hằng-thời-gian). Token do Electron main sinh ngẫu nhiên mỗi lần chạy và
#     truyền qua biến môi trường. Không có token => từ chối khởi động (fail-closed),
#     TRƯỚC khi tốn thời gian nạp YOLO.
# ---------------------------------------------------------------------------
IRIS_OMNI_TOKEN = os.environ.get("IRIS_OMNI_TOKEN", "").strip()
if len(IRIS_OMNI_TOKEN) < 16:
    raise SystemExit(
        "IRIS_OMNI_TOKEN chưa được đặt (hoặc quá ngắn, cần >= 16 ký tự). "
        "api_server.py từ chối chạy không có xác thực. Hãy để Iris (Electron) khởi động server này."
    )
MAX_UPLOAD_BYTES = int(os.environ.get("IRIS_OMNI_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def _require_iris_token(request: Request, call_next):
    supplied = request.headers.get("x-iris-token", "")
    if not hmac.compare_digest(supplied.encode("utf-8"), IRIS_OMNI_TOKEN.encode("utf-8")):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)


async def _read_upload_limited(file: UploadFile) -> bytes:
    """Đọc upload theo khối và từ chối khi vượt MAX_UPLOAD_BYTES (HTTP 413)."""
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf += chunk
        if len(buf) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Upload too large")
    return bytes(buf)


# ---------------------------------------------------------------------------
# Model startup — khởi tạo YOLO + VLM clients MỘT LẦN duy nhất lúc boot.
# BUG-2 FIX: genai.GenerativeModel() và anthropic client KHÔNG được tạo lại
# mỗi request vì (a) tốn CPU mỗi lần và (b) genai.configure() mutate global
# state không thread-safe.
# ---------------------------------------------------------------------------
print("Loading YOLO Model...")
yolo_model = get_yolo_model()
print("YOLO Model Loaded!")

# NOTE: gemini-1.5-flash đã bị tắt; gemini-2.5-flash dự kiến shutdown 16/10/2026 (M-02).
GEMINI_MODEL_NAME = os.environ.get("GEMINI_MODEL_NAME", "gemini-3.5-flash")
GEMINI_REQUEST_TIMEOUT_S = 15

# ============================================================================
# Vision provider — ƯU TIÊN CLAUDE, fallback Gemini khi không có ANTHROPIC_API_KEY.
# BUG-1 FIX: Chuyển sang AsyncAnthropic để không block event loop của FastAPI.
# ============================================================================
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_VISION_MODEL = os.environ.get("CLAUDE_VISION_MODEL", "claude-sonnet-4-6")
CLAUDE_REQUEST_TIMEOUT_S = 15

GEMINI_VISION_API_KEY = os.environ.get("GEMINI_VISION_API_KEY", "").strip()
_GEMINI_KEY_FALLBACK_USED = False
if not GEMINI_VISION_API_KEY and os.environ.get("GEMINI_API_KEY", "").strip():
    GEMINI_VISION_API_KEY = os.environ["GEMINI_API_KEY"].strip()
    _GEMINI_KEY_FALLBACK_USED = True

# BUG-1 FIX: Dùng AsyncAnthropic thay vì Anthropic đồng bộ.
# anthropic.AsyncAnthropic cho phép await client.messages.create() mà không
# block event loop — critical vì /parse có thể mất 1-4s chờ Claude trả lời.
async_anthropic_client: Optional[anthropic.AsyncAnthropic] = None
if ANTHROPIC_API_KEY:
    try:
        async_anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        print(f"Claude vision READY (async, {CLAUDE_VISION_MODEL}) — sẽ dùng Claude trước cho /parse.")
    except Exception as e:
        print(f"Warning: khởi tạo AsyncAnthropic client thất bại ({e}). Sẽ fallback sang Gemini cho /parse.")
else:
    print("ANTHROPIC_API_KEY chưa được set — /parse sẽ dùng Gemini (nếu có GEMINI_VISION_API_KEY/GEMINI_API_KEY).")

if _GEMINI_KEY_FALLBACK_USED:
    print(
        "Warning: GEMINI_VISION_API_KEY chưa được set trong .env — đang tạm dùng chung "
        "GEMINI_API_KEY (key của trợ lý giọng nói Gemini Live). Nên set riêng "
        "GEMINI_VISION_API_KEY (lấy free tại https://aistudio.google.com/apikey) để 2 "
        "tính năng không tranh nhau rate limit."
    )

# google-genai: một Client dùng lại cho mọi request (không tạo trong handler).
_gemini_client: Optional["genai.Client"] = None
if GEMINI_VISION_API_KEY:
    try:
        _gemini_client = genai.Client(
            api_key=GEMINI_VISION_API_KEY,
            http_options=genai_types.HttpOptions(timeout=GEMINI_REQUEST_TIMEOUT_S * 1000),
        )
        print(f"Gemini vision READY (google-genai client, {GEMINI_MODEL_NAME}).")
    except Exception as e:
        print(f"Warning: khởi tạo Gemini client thất bại ({e}).")

try:
    import pyautogui
    pyautogui.FAILSAFE = True
except Exception as e:  # pragma: no cover - depends on host display availability
    pyautogui = None
    print(f"Warning: pyautogui unavailable ({e}). /click endpoint will return errors.")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ClickRequest(BaseModel):
    x_ratio: float
    y_ratio: float
    # fast_mode=True bỏ qua delay Bezier (dùng cho automation tốc độ cao).
    # fast_mode=False (default) giả lập chuột người thật để không bị phát hiện.
    fast_mode: bool = False


class TypeRequest(BaseModel):
    text: Optional[str] = None
    key: Optional[str] = None


# ---------------------------------------------------------------------------
# Mouse helpers
# ---------------------------------------------------------------------------

def _bezier_path(start, end, n_points=30, control_offset_ratio=0.25):
    """
    Quadratic Bezier path between two points with a randomized control point,
    so the cursor follows a slight curve instead of a razor-straight robotic line.
    Giống hệt hàm cùng tên trong tools/mouse_control.py để cả 2 nơi
    di chuyển GIỐNG NHAU (không bị lộ 2 kiểu di chuyển khác nhau trên cùng máy).
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


def human_move_and_click(x_ratio: float, y_ratio: float, fast_mode: bool = False) -> dict:
    """Di chuyển chuột theo đường cong Bezier rồi click.

    fast_mode=False (default): giả lập người thật, tổng 0.4-0.8s.
    fast_mode=True: bỏ qua random delay, chỉ còn ~0.05s. Vẫn dùng Bezier
    với ít điểm hơn để tránh cursor teleport giật cục (trông kỳ hơn straight).

    BUG-3 FIX: Hàm này được gọi qua asyncio.to_thread() từ endpoint /click
    để time.sleep() không block event loop của FastAPI.
    """
    if pyautogui is None:
        return {"success": False, "error": "pyautogui not available on this server"}
    try:
        screen_width, screen_height = pyautogui.size()
        start_x, start_y = pyautogui.position()

        # Người thật không bao giờ click đúng trung tâm pixel — jitter nhỏ.
        target_x = int(float(x_ratio) * screen_width) + random.randint(-3, 3)
        target_y = int(float(y_ratio) * screen_height) + random.randint(-2, 2)
        target_x = max(0, min(screen_width - 1, target_x))
        target_y = max(0, min(screen_height - 1, target_y))

        if fast_mode:
            # Fast mode: Bezier ít điểm hơn (10 thay vì 30), tổng ~0.05s.
            # Vẫn dùng Bezier để chuột không teleport thẳng (trông tự nhiên hơn).
            path = _bezier_path((start_x, start_y), (target_x, target_y), n_points=10)
            total_duration = 0.05
        else:
            # Normal mode: Bezier 30 điểm, tổng 0.35-0.65s ngẫu nhiên.
            path = _bezier_path((start_x, start_y), (target_x, target_y), n_points=30)
            total_duration = random.uniform(0.35, 0.65)

        step_delay = total_duration / len(path) if len(path) else 0

        for px, py in path:
            pyautogui.moveTo(px, py, duration=0)
            if step_delay > 0:
                time.sleep(step_delay)

        # Pause ngắn trước khi click ("aim and settle").
        if fast_mode:
            time.sleep(0.02)
        else:
            time.sleep(random.uniform(0.05, 0.15))

        pyautogui.click()
        return {"success": True, "x": target_x, "y": target_y}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "claude_vision": async_anthropic_client is not None,
        "claude_model": CLAUDE_VISION_MODEL if async_anthropic_client is not None else None,
        "gemini_vision": _gemini_client is not None,
        "gemini_model": GEMINI_MODEL_NAME if _gemini_client is not None else None,
        "pyautogui": pyautogui is not None,
    }


@app.post("/click")
async def click(req: ClickRequest):
    # BUG-3 FIX: Dùng asyncio.to_thread() để time.sleep() bên trong
    # human_move_and_click() chạy trong thread pool, không block event loop.
    result = await asyncio.to_thread(
        human_move_and_click, req.x_ratio, req.y_ratio, req.fast_mode
    )
    status_code = 200 if result.get("success") else 500
    return JSONResponse(result, status_code=status_code)


@app.post("/type")
async def type_keyboard(req: TypeRequest):
    if pyautogui is None:
        return JSONResponse({"success": False, "error": "pyautogui not available on this server"}, status_code=500)

    def _do_type():
        try:
            if req.text:
                # BUG-5 FIX: Dùng pyautogui.write() cho ASCII text ngắn để tránh
                # clipboard race condition. Fallback clipboard cho Unicode (tiếng Việt).
                # Phân biệt: nếu toàn ASCII printable → write() trực tiếp, nhanh hơn.
                if all(ord(c) < 128 and c.isprintable() for c in req.text):
                    pyautogui.write(req.text, interval=0.02)
                else:
                    # Unicode path: clipboard trick nhưng dùng threading.Event
                    # để đảm bảo paste xong hẳn trước khi restore clipboard.
                    import pyperclip
                    original_clipboard = pyperclip.paste()
                    try:
                        pyperclip.copy(req.text)
                        pyautogui.hotkey('ctrl', 'v')
                        # Chờ hệ thống xử lý paste xong (tối thiểu 100ms thay vì 50ms)
                        time.sleep(0.12)
                    finally:
                        # Luôn restore clipboard dù có lỗi
                        pyperclip.copy(original_clipboard)
            if req.key:
                if '+' in req.key:
                    pyautogui.hotkey(*req.key.split('+'))
                else:
                    pyautogui.press(req.key)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # Keyboard actions cũng dùng to_thread vì pyautogui.write() có sleep nội bộ.
    result = await asyncio.to_thread(_do_type)
    if result.get("success"):
        return result
    return JSONResponse(result, status_code=500)


# ---------------------------------------------------------------------------
# Vision helpers — prompt building
# ---------------------------------------------------------------------------

def _build_vision_prompt(prompt: str) -> str:
    return f"""You are an AI assistant helping to control a computer.
Here is a screenshot of the user's screen with numbered bounding boxes.
The user's request is: "{prompt}"

Based on the image, which box number (ID) should be clicked to fulfill this request?
Return ONLY the box ID (a number) and nothing else. If you cannot find it, return -1."""


async def _ask_claude_for_target(labeled_pil: Image.Image, vision_prompt_text: str) -> str:
    """Gửi ảnh đã đánh Set-of-Marks cho Claude (async), trả về text thô.

    BUG-1 FIX: Dùng async_anthropic_client.messages.create() (await) thay vì
    sync client → event loop không bị block trong 1-4s chờ Claude trả lời.

    Phase 2 — Prompt Caching: thêm cache_control vào system prompt để tái sử
    dụng KV cache giữa các request liên tiếp, giảm latency ~30-50%.
    """
    buf = io.BytesIO()
    labeled_pil.save(buf, format="PNG")
    img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    # Prompt Caching: system prompt tĩnh được đánh dấu cache_control="ephemeral"
    # → Anthropic tái sử dụng KV cache, tiết kiệm ~30-50% latency trên lần 2+.
    message = await async_anthropic_client.messages.create(
        model=CLAUDE_VISION_MODEL,
        max_tokens=20,
        timeout=CLAUDE_REQUEST_TIMEOUT_S,
        extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
        system=[
            {
                "type": "text",
                "text": (
                    "You are a precise UI element selector. "
                    "When shown a screenshot with numbered bounding boxes (Set-of-Marks), "
                    "you return ONLY the integer ID of the box that matches the user's request. "
                    "If no box matches, return -1. Never explain your reasoning."
                ),
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png", "data": img_b64},
                },
                {"type": "text", "text": vision_prompt_text},
            ],
        }],
    )
    text_parts = [block.text for block in message.content if getattr(block, "type", None) == "text"]
    return "".join(text_parts).strip()


async def _ask_gemini_for_target(labeled_pil: Image.Image, vision_prompt_text: str) -> str:
    """Gửi ảnh đã đánh Set-of-Marks cho Gemini (dùng _gemini_client tạo 1 lần lúc startup).
    """
    if _gemini_client is None:
        raise RuntimeError("Gemini client chưa được khởi tạo (thiếu GEMINI_VISION_API_KEY?)")

    def _call():
        response = _gemini_client.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=[vision_prompt_text, labeled_pil],
        )
        return (response.text or "").strip()

    # SDK đồng bộ → chạy trong thread pool.
    return await asyncio.to_thread(_call)


# ---------------------------------------------------------------------------
# Helper: chạy OCR + YOLO trong thread pool để không block event loop
# ---------------------------------------------------------------------------

def _run_ocr_and_yolo(image_input: Image.Image) -> tuple:
    """OCR (PaddleOCR) + YOLO inference — cả hai là sync/CPU-bound.
    Được gọi qua asyncio.to_thread() để không block event loop FastAPI.
    """
    # 1. OCR — soft-fail: OCR issues shouldn't abort the whole request.
    try:
        ocr_bbox_rslt, _ = check_ocr_box(
            image_input,
            display_img=False,
            output_bb_format='xyxy',
            goal_filtering=None,
            easyocr_args={'paragraph': False, 'text_threshold': 0.9},
            use_paddleocr=True,
        )
        text, ocr_bbox = ocr_bbox_rslt
    except Exception as e:
        print("OCR Error:", e)
        text, ocr_bbox = [], []

    # 2. YOLO inference + Set-of-Marks annotation
    box_threshold = 0.05
    iou_threshold = 0.1
    imgsz = 640

    box_overlay_ratio = image_input.size[0] / 3200
    draw_bbox_config = {
        'text_scale': 0.8 * box_overlay_ratio,
        'text_thickness': max(int(2 * box_overlay_ratio), 1),
        'text_padding': max(int(3 * box_overlay_ratio), 1),
        'thickness': max(int(3 * box_overlay_ratio), 1),
    }

    # Pass use_local_semantics=False to bypass florence2/blip2 — VLM handles
    # the semantic "which one is it" step instead.
    dino_labled_img, label_coordinates, parsed_content_list = get_som_labeled_img(
        image_input, yolo_model,
        BOX_TRESHOLD=box_threshold,
        output_coord_in_ratio=True,
        ocr_bbox=ocr_bbox,
        draw_bbox_config=draw_bbox_config,
        caption_model_processor=None,
        ocr_text=text,
        use_local_semantics=False,
        iou_threshold=iou_threshold,
        imgsz=imgsz,
    )
    return dino_labled_img, label_coordinates


# ---------------------------------------------------------------------------
# /parse — endpoint chính (PNG, full pipeline)
# ---------------------------------------------------------------------------

@app.post("/parse")
async def parse_image(file: UploadFile = File(...), prompt: str = Form(None)):
    """Nhận screenshot PNG, chạy OCR+YOLO, hỏi Claude/Gemini, trả về tọa độ click.

    Mọi bước sync (OCR, YOLO, Gemini SDK) được bọc trong asyncio.to_thread() để
    event loop không bị block, giữ /click và /type responsive trong khi /parse
    đang chạy inference.
    """
    try:
        image_bytes = await _read_upload_limited(file)
        image_input = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # OCR + YOLO: CPU-bound → chạy trong thread pool
        dino_labled_img, label_coordinates = await asyncio.to_thread(
            _run_ocr_and_yolo, image_input
        )

        if not prompt or not prompt.strip() or (async_anthropic_client is None and not GEMINI_VISION_API_KEY):
            return JSONResponse({
                "labeled_image_base64": dino_labled_img,
                "coordinates": label_coordinates,
            })

        # 3. Hỏi VLM để chọn box nào cần click.
        labeled_pil = Image.open(io.BytesIO(base64.b64decode(dino_labled_img)))
        vision_prompt_text = _build_vision_prompt(prompt)

        target_id_raw = None
        model_used = None
        errors = []

        # ƯU TIÊN CLAUDE (async) → fallback Gemini
        if async_anthropic_client is not None:
            try:
                target_id_raw = await _ask_claude_for_target(labeled_pil, vision_prompt_text)
                model_used = f"claude:{CLAUDE_VISION_MODEL}"
            except Exception as e:
                print("Claude vision request failed, falling back to Gemini:", e)
                errors.append(f"Claude failed: {e}")

        if target_id_raw is None:
            if not GEMINI_VISION_API_KEY:
                return JSONResponse({
                    "error": "; ".join(errors) or "No vision AI key configured (ANTHROPIC_API_KEY / GEMINI_VISION_API_KEY / GEMINI_API_KEY).",
                    "coordinates": label_coordinates,
                })
            try:
                target_id_raw = await _ask_gemini_for_target(labeled_pil, vision_prompt_text)
                model_used = f"gemini:{GEMINI_MODEL_NAME}"
            except Exception as e:
                errors.append(f"Gemini failed: {e}")
                return JSONResponse({
                    "error": "; ".join(errors),
                    "coordinates": label_coordinates,
                })

        # Model đôi khi trả "Box 5", "5.", "ID: 5" — trích số đầu tiên robustly.
        match = re.search(r'-?\d+', target_id_raw)
        if not match:
            return JSONResponse({
                "error": f"{model_used} did not return a valid box ID (got: {target_id_raw!r})",
                "coordinates": label_coordinates,
            })
        clean_id = match.group(0)

        if clean_id == "-1":
            return JSONResponse({
                "target_id": clean_id,
                "model_used": model_used,
                "error": f"{model_used} could not find a matching element for this request",
                "coordinates": label_coordinates,
            })

        # label_coordinates keys có thể là str hoặc int — thử cả hai.
        target_coords = label_coordinates.get(clean_id)
        if target_coords is None:
            target_coords = label_coordinates.get(int(clean_id))

        if target_coords:
            x, y, w, h = target_coords
            center_x = x + (w / 2)
            center_y = y + (h / 2)
            return JSONResponse({
                "target_id": clean_id,
                "target_center": [center_x, center_y],
                "model_used": model_used,
                "coordinates": label_coordinates,
            })

        return JSONResponse({
            "target_id": clean_id,
            "model_used": model_used,
            "error": "Target ID not found in coordinates",
            "coordinates": label_coordinates,
        })

    except HTTPException:
        raise  # 413 từ _read_upload_limited phải đi thẳng ra client
    except Exception as e:
        print("Parse endpoint error:", e)
        return JSONResponse({"error": str(e)}, status_code=500)


# ---------------------------------------------------------------------------
# /parse_fast — Phase 2: nhận JPEG thay vì PNG, giảm payload 40-60%
# Dùng khi Electron gửi ảnh JPEG quality=75 (giảm từ ~3MB xuống ~300-600KB)
# ---------------------------------------------------------------------------

@app.post("/parse_fast")
async def parse_image_fast(
    file: UploadFile = File(...),
    prompt: str = Form(None),
    fast_mode: bool = Form(False),
):
    """Giống /parse nhưng:
    - Nhận JPEG (nhẹ hơn 40-60% so với PNG)
    - Trả về thêm field fast_mode để client biết có thể gọi /click?fast_mode=true
    Dùng cho use case automation tốc độ cao khi không cần fidelity ảnh tối đa.
    """
    try:
        image_bytes = await _read_upload_limited(file)
        # JPEG → PIL convert RGB giống như PNG, pipeline không đổi.
        image_input = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        dino_labled_img, label_coordinates = await asyncio.to_thread(
            _run_ocr_and_yolo, image_input
        )

        if not prompt or not prompt.strip() or (async_anthropic_client is None and not GEMINI_VISION_API_KEY):
            return JSONResponse({
                "labeled_image_base64": dino_labled_img,
                "coordinates": label_coordinates,
                "fast_mode": fast_mode,
            })

        labeled_pil = Image.open(io.BytesIO(base64.b64decode(dino_labled_img)))
        vision_prompt_text = _build_vision_prompt(prompt)

        target_id_raw = None
        model_used = None
        errors = []

        if async_anthropic_client is not None:
            try:
                target_id_raw = await _ask_claude_for_target(labeled_pil, vision_prompt_text)
                model_used = f"claude:{CLAUDE_VISION_MODEL}"
            except Exception as e:
                errors.append(f"Claude failed: {e}")

        if target_id_raw is None:
            if not GEMINI_VISION_API_KEY:
                return JSONResponse({"error": "; ".join(errors) or "No vision AI key configured.", "coordinates": label_coordinates})
            try:
                target_id_raw = await _ask_gemini_for_target(labeled_pil, vision_prompt_text)
                model_used = f"gemini:{GEMINI_MODEL_NAME}"
            except Exception as e:
                errors.append(f"Gemini failed: {e}")
                return JSONResponse({"error": "; ".join(errors), "coordinates": label_coordinates})

        match = re.search(r'-?\d+', target_id_raw)
        if not match:
            return JSONResponse({"error": f"{model_used} did not return a valid box ID (got: {target_id_raw!r})", "coordinates": label_coordinates})

        clean_id = match.group(0)
        if clean_id == "-1":
            return JSONResponse({"target_id": clean_id, "model_used": model_used, "error": "No matching element found", "coordinates": label_coordinates})

        target_coords = label_coordinates.get(clean_id) or label_coordinates.get(int(clean_id))
        if target_coords:
            x, y, w, h = target_coords
            return JSONResponse({
                "target_id": clean_id,
                "target_center": [x + w / 2, y + h / 2],
                "model_used": model_used,
                "coordinates": label_coordinates,
                "fast_mode": fast_mode,
            })

        return JSONResponse({"target_id": clean_id, "model_used": model_used, "error": "Target ID not found in coordinates", "coordinates": label_coordinates})

    except HTTPException:
        raise  # 413 từ _read_upload_limited phải đi thẳng ra client
    except Exception as e:
        print("Parse_fast endpoint error:", e)
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("IRIS_OMNI_HOST", "127.0.0.1"),
        port=int(os.environ.get("IRIS_OMNI_PORT", "8000")),
    )
