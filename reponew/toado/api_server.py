import os
import io
import re
import time
import random
import base64
from typing import Optional
from dotenv import load_dotenv

# Tự động nạp biến môi trường từ file .env ở thư mục gốc (irit)
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
from PIL import Image
import torch
import google.generativeai as genai
import anthropic

from util.utils import check_ocr_box, get_yolo_model, get_som_labeled_img

app = FastAPI()

print("Loading YOLO Model...")
yolo_model = get_yolo_model()
print("YOLO Model Loaded!")

# NOTE: gemini-1.5-flash has been shut down by Google (all requests now 404).
# Use a currently-supported, cost-efficient Flash model instead. Check
# https://ai.google.dev/gemini-api/docs/deprecations for the latest status if
# this ever starts failing again.
GEMINI_MODEL_NAME = os.environ.get("GEMINI_MODEL_NAME", "gemini-2.5-flash")
GEMINI_REQUEST_TIMEOUT_S = 15

# ============================================================================
# Vision provider cho bước "chọn khung nào để click": ƯU TIÊN CLAUDE, chỉ
# dùng Gemini khi máy KHÔNG có ANTHROPIC_API_KEY. Lý do ưu tiên Claude:
# Claude vision nhìn ảnh Set-of-Marks (khung số) chính xác hơn Gemini Flash
# ở tác vụ "chọn đúng 1 khung trong danh sách nhiều khung nhỏ".
#
# ANTHROPIC_API_KEY dùng chung biến với electron/computer-session.mjs (tính
# năng Computer Use full-agent) — không phải biến mới, nên nếu bạn đã bật
# Computer Use rồi thì tính năng click-theo-prompt này tự động dùng Claude
# luôn mà không cần cấu hình gì thêm.
#
# GEMINI_VISION_API_KEY là biến MỚI, TÁCH RIÊNG khỏi GEMINI_API_KEY mà
# electron/main/gemini-live.mjs dùng cho trợ lý giọng nói (Gemini Live) —
# để 2 tính năng không ăn chung 1 quota rate-limit của cùng 1 API key khi cả
# hai cùng hoạt động (Gemini Live nói chuyện liên tục + click ảnh cùng lúc
# rất dễ đụng rate limit nếu dùng chung key). Nếu bạn không set
# GEMINI_VISION_API_KEY, server sẽ tạm fallback dùng chung GEMINI_API_KEY
# (để không phá vỡ setup cũ) nhưng in cảnh báo 1 lần lúc khởi động.
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_VISION_MODEL = os.environ.get("CLAUDE_VISION_MODEL", "claude-3-5-sonnet-20241022")
CLAUDE_REQUEST_TIMEOUT_S = 15

GEMINI_VISION_API_KEY = os.environ.get("GEMINI_VISION_API_KEY", "").strip()
_GEMINI_KEY_FALLBACK_USED = False
if not GEMINI_VISION_API_KEY and os.environ.get("GEMINI_API_KEY", "").strip():
    GEMINI_VISION_API_KEY = os.environ["GEMINI_API_KEY"].strip()
    _GEMINI_KEY_FALLBACK_USED = True

anthropic_client = None
if ANTHROPIC_API_KEY:
    try:
        anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        print(f"Claude vision READY ({CLAUDE_VISION_MODEL}) — sẽ dùng Claude trước cho /parse.")
    except Exception as e:
        print(f"Warning: khởi tạo Anthropic client thất bại ({e}). Sẽ fallback sang Gemini cho /parse.")
else:
    print("ANTHROPIC_API_KEY chưa được set — /parse sẽ dùng Gemini (nếu có GEMINI_VISION_API_KEY/GEMINI_API_KEY).")

if _GEMINI_KEY_FALLBACK_USED:
    print(
        "Warning: GEMINI_VISION_API_KEY chưa được set trong .env — đang tạm dùng chung "
        "GEMINI_API_KEY (key của trợ lý giọng nói Gemini Live). Nên set riêng "
        "GEMINI_VISION_API_KEY (lấy free tại https://aistudio.google.com/apikey) để 2 "
        "tính năng không tranh nhau rate limit."
    )

try:
    import pyautogui
    pyautogui.FAILSAFE = True
except Exception as e:  # pragma: no cover - depends on host display availability
    pyautogui = None
    print(f"Warning: pyautogui unavailable ({e}). /click endpoint will return errors.")


class ClickRequest(BaseModel):
    x_ratio: float
    y_ratio: float


def _bezier_path(start, end, n_points=30, control_offset_ratio=0.25):
    """
    Quadratic Bezier path between two points with a randomized control point,
    so the cursor follows a slight curve instead of a razor-straight robotic line.
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


def human_move_and_click(x_ratio: float, y_ratio: float) -> dict:
    """Move the mouse along a curved, variable-speed path and click, so the
    motion doesn't look like a teleporting robot cursor."""
    if pyautogui is None:
        return {"success": False, "error": "pyautogui not available on this server"}
    try:
        screen_width, screen_height = pyautogui.size()
        start_x, start_y = pyautogui.position()

        # Real users never click the exact pixel center every time — add a
        # small random jitter around the target.
        target_x = int(float(x_ratio) * screen_width) + random.randint(-3, 3)
        target_y = int(float(y_ratio) * screen_height) + random.randint(-2, 2)
        target_x = max(0, min(screen_width - 1, target_x))
        target_y = max(0, min(screen_height - 1, target_y))

        path = _bezier_path((start_x, start_y), (target_x, target_y), n_points=30)

        # Randomize total travel time each call instead of a fixed constant —
        # identical timing every time is itself a robotic tell.
        total_duration = random.uniform(0.35, 0.65)
        step_delay = total_duration / len(path)

        for px, py in path:
            pyautogui.moveTo(px, py, duration=0)
            time.sleep(step_delay)

        # Small "aim and settle" pause before clicking, like a human would.
        time.sleep(random.uniform(0.05, 0.15))
        pyautogui.click()

        return {"success": True, "x": target_x, "y": target_y}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/click")
async def click(req: ClickRequest):
    result = human_move_and_click(req.x_ratio, req.y_ratio)
    status_code = 200 if result.get("success") else 500
    return JSONResponse(result, status_code=status_code)

class TypeRequest(BaseModel):
    text: Optional[str] = None
    key: Optional[str] = None

@app.post("/type")
async def type_keyboard(req: TypeRequest):
    if pyautogui is None:
        return JSONResponse({"success": False, "error": "pyautogui not available on this server"}, status_code=500)
    try:
        if req.text:
            import pyperclip
            original_clipboard = pyperclip.paste()
            # Đảm bảo dùng đúng định dạng xuống dòng của Windows (\r\n) để tránh lỗi đè dòng
            safe_text = req.text.replace('\r\n', '\n').replace('\n', '\r\n')
            pyperclip.copy(safe_text)
            pyautogui.hotkey('ctrl', 'v')
            # Doi 0.5s (thay vi 0.05s) de cac app nang tren Windows kip doc
            # clipboard truoc khi ta restore lai clipboard cu. Neu delay qua
            # ngan, app se paste ra noi dung cu hoac khong paste gi ca!
            time.sleep(0.5)
            pyperclip.copy(original_clipboard)
        if req.key:
            if '+' in req.key:
                pyautogui.hotkey(*req.key.split('+'))
            elif len(req.key) > 1 and req.key.lower() not in pyautogui.KEYBOARD_KEYS:
                # Gemini gửi nhầm chữ dài vào trường 'key' thay vì 'text'.
                # Gõ từng phím sẽ bị lỗi bộ gõ tiếng Việt (Unikey), nên phải ép dùng clipboard.
                import pyperclip
                original_clipboard = pyperclip.paste()
                safe_text = req.key.replace('\r\n', '\n').replace('\n', '\r\n')
                pyperclip.copy(safe_text)
                pyautogui.hotkey('ctrl', 'v')
                time.sleep(0.5)
                pyperclip.copy(original_clipboard)
            else:
                pyautogui.press(req.key)
        return {"success": True}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

def _build_vision_prompt(prompt: str) -> str:
    return f"""
    You are an AI assistant helping to control a computer.
    Here is a screenshot of the user's screen with numbered bounding boxes.
    The user's request is: "{prompt}"

    Based on the image, which box number (ID) should be clicked to fulfill this request?
    Return ONLY the box ID (a number) and nothing else. If you cannot find it, return -1.
    """


def _ask_claude_for_target(labeled_pil: Image.Image, vision_prompt_text: str) -> str:
    """Gửi ảnh đã đánh Set-of-Marks cho Claude, trả về text thô Claude trả lời
    (kỳ vọng là một số ID). Raise exception nếu gọi API lỗi — caller sẽ tự
    fallback sang Gemini."""
    buf = io.BytesIO()
    labeled_pil.save(buf, format="PNG")
    img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    message = anthropic_client.messages.create(
        model=CLAUDE_VISION_MODEL,
        max_tokens=20,
        timeout=CLAUDE_REQUEST_TIMEOUT_S,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img_b64}},
                {"type": "text", "text": vision_prompt_text},
            ],
        }],
    )
    text_parts = [block.text for block in message.content if getattr(block, "type", None) == "text"]
    return "".join(text_parts).strip()


def _ask_gemini_for_target(labeled_pil: Image.Image, vision_prompt_text: str) -> str:
    """Gửi ảnh đã đánh Set-of-Marks cho Gemini (dùng GEMINI_VISION_API_KEY,
    xem comment ở đầu file), trả về text thô Gemini trả lời. Raise exception
    nếu gọi API lỗi."""
    genai.configure(api_key=GEMINI_VISION_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL_NAME)
    response = model.generate_content(
        [vision_prompt_text, labeled_pil],
        request_options={"timeout": GEMINI_REQUEST_TIMEOUT_S},
    )
    return (response.text or "").strip()


@app.post("/parse")
async def parse_image(file: UploadFile = File(...), prompt: str = Form(None)):
    # Everything below is wrapped in one try/except so any failure (OCR, YOLO,
    # Gemini, or anything else) always comes back as JSON with an "error" key
    # instead of FastAPI's raw HTML 500 traceback, which the Node.js caller
    # can't parse and would otherwise show up only as a generic
    # "Internal Server Error" with no useful detail.
    try:
        image_bytes = await file.read()
        image_input = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # 1. OCR (PaddleOCR if available) — soft-fail: OCR issues shouldn't
        # abort the whole request, since YOLO detections alone can still be useful.
        try:
            ocr_bbox_rslt, _ = check_ocr_box(
                image_input,
                display_img=False,
                output_bb_format='xyxy',
                goal_filtering=None,
                easyocr_args={'paragraph': False, 'text_threshold': 0.9},
                use_paddleocr=True
            )
            text, ocr_bbox = ocr_bbox_rslt
        except Exception as e:
            print("OCR Error:", e)
            text, ocr_bbox = [], []

        # 2. Get boxes and draw them
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

        # Pass use_local_semantics=False to bypass florence2/blip2 — Gemini
        # handles the semantic "which one is it" step instead.
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

        try:
            debug_dir = os.path.join(os.path.dirname(__file__), "omni_debug")
            os.makedirs(debug_dir, exist_ok=True)
            # Xóa các file cũ
            for f_name in os.listdir(debug_dir):
                os.remove(os.path.join(debug_dir, f_name))
                
            # Lưu ảnh đã đánh số (dino_labled_img là base64 string)
            img_data = base64.b64decode(dino_labled_img)
            with open(os.path.join(debug_dir, "latest_labeled_image.png"), "wb") as f:
                f.write(img_data)
                
            # Lưu danh sách tọa độ với định dạng AI-friendly
            with open(os.path.join(debug_dir, "latest_coordinates.txt"), "w", encoding="utf-8") as f:
                f.write("# Định dạng: ID | Tâm (Center_X, Center_Y) | Khung (BBox [x, y, w, h])\n")
                f.write("# Tất cả giá trị đều là tỉ lệ (0.0 - 1.0) so với kích thước thật của ảnh.\n")
                for box_id, coords in label_coordinates.items():
                    x, y, w, h = coords
                    cx, cy = x + w/2, y + h/2
                    f.write(f"ID: {box_id} | Center: {cx:.4f}, {cy:.4f} | BBox: [{x:.4f}, {y:.4f}, {w:.4f}, {h:.4f}]\n")
        except Exception as e:
            print(f"Warning: Failed to save debug outputs to omni_debug: {e}")

        if not prompt or not prompt.strip() or (anthropic_client is None and not GEMINI_VISION_API_KEY):
            return JSONResponse({
                "labeled_image_base64": dino_labled_img,
                "coordinates": label_coordinates,
            })

        # 3. If prompt is provided, ask an AI model which box to click.
        # ƯU TIÊN CLAUDE trước — chỉ dùng Gemini khi không có Claude, hoặc
        # khi Claude vừa gọi bị lỗi (rate limit/timeout/...).
        labeled_pil = Image.open(io.BytesIO(base64.b64decode(dino_labled_img)))
        vision_prompt_text = _build_vision_prompt(prompt)

        target_id_raw = None
        model_used = None
        errors = []

        if anthropic_client is not None:
            try:
                target_id_raw = _ask_claude_for_target(labeled_pil, vision_prompt_text)
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
                target_id_raw = _ask_gemini_for_target(labeled_pil, vision_prompt_text)
                model_used = f"gemini:{GEMINI_MODEL_NAME}"
            except Exception as e:
                errors.append(f"Gemini failed: {e}")
                return JSONResponse({
                    "error": "; ".join(errors),
                    "coordinates": label_coordinates,
                })

        # Model can still ignore the "return only the number" instruction
        # (e.g. "Box 5", "5.", "ID: 5") — extract the first integer robustly
        # instead of doing a brittle exact dict lookup on the raw string.
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

        # label_coordinates keys may be stored as either str or int
        # depending on how get_som_labeled_img built the dict — try both
        # rather than silently failing on a type mismatch.
        target_coords = label_coordinates.get(clean_id)
        if target_coords is None:
            target_coords = label_coordinates.get(int(clean_id))

        if target_coords:
            # target_coords is [xmin_ratio, ymin_ratio, w_ratio, h_ratio] (xywh)
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

    except Exception as e:
        # Catches OCR/YOLO/image-decoding/etc. failures that aren't already
        # handled above, so the caller always gets JSON, never a raw traceback.
        print("Parse endpoint error:", e)
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
