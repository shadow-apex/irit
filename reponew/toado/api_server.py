import os
import io
import re
import time
import random
import base64
from typing import Optional
from dotenv import load_dotenv

# Tự động nạp biến môi trường từ file .env ở thư mục gốc myiris
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
from PIL import Image
import torch
import google.generativeai as genai

from util.utils import check_ocr_box, get_yolo_model, get_som_labeled_img

app = FastAPI()

print("Loading YOLO Model...")
yolo_model = get_yolo_model()
print("YOLO Model Loaded!")

# NOTE: gemini-1.5-flash has been shut down by Google (all requests now 404).
# Use a currently-supported, cost-efficient Flash model instead. Check
# https://ai.google.dev/gemini-api/docs/deprecations for the latest status if
# this ever starts failing again.
GEMINI_MODEL_NAME = os.environ.get("GEMINI_MODEL_NAME", "gemini-2.5-flash-lite")
GEMINI_REQUEST_TIMEOUT_S = 15

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
            pyperclip.copy(req.text)
            pyautogui.hotkey('ctrl', 'v')
            time.sleep(0.05)
            pyperclip.copy(original_clipboard)
        if req.key:
            if '+' in req.key:
                pyautogui.hotkey(*req.key.split('+'))
            else:
                pyautogui.press(req.key)
        return {"success": True}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

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

        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not prompt or not prompt.strip() or not api_key:
            return JSONResponse({
                "labeled_image_base64": dino_labled_img,
                "coordinates": label_coordinates,
            })

        # 3. If prompt is provided, ask Gemini which box to click
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(GEMINI_MODEL_NAME)

            labeled_pil = Image.open(io.BytesIO(base64.b64decode(dino_labled_img)))

            gemini_prompt = f"""
            You are an AI assistant helping to control a computer.
            Here is a screenshot of the user's screen with numbered bounding boxes.
            The user's request is: "{prompt}"

            Based on the image, which box number (ID) should be clicked to fulfill this request?
            Return ONLY the box ID (a number) and nothing else. If you cannot find it, return -1.
            """

            response = model.generate_content(
                [gemini_prompt, labeled_pil],
                request_options={"timeout": GEMINI_REQUEST_TIMEOUT_S},
            )
            target_id_raw = (response.text or "").strip()

            # Gemini can still ignore the "return only the number" instruction
            # (e.g. "Box 5", "5.", "ID: 5") — extract the first integer robustly
            # instead of doing a brittle exact dict lookup on the raw string.
            match = re.search(r'-?\d+', target_id_raw)
            if not match:
                return JSONResponse({
                    "error": f"Gemini did not return a valid box ID (got: {target_id_raw!r})",
                    "coordinates": label_coordinates,
                })
            clean_id = match.group(0)

            if clean_id == "-1":
                return JSONResponse({
                    "target_id": clean_id,
                    "error": "Gemini could not find a matching element for this request",
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
                    "coordinates": label_coordinates,
                })

            return JSONResponse({
                "target_id": clean_id,
                "error": "Target ID not found in coordinates",
                "coordinates": label_coordinates,
            })
        except Exception as e:
            return JSONResponse({
                "error": f"Gemini request failed: {e}",
                "coordinates": label_coordinates,
            })

    except Exception as e:
        # Catches OCR/YOLO/image-decoding/etc. failures that aren't already
        # handled above, so the caller always gets JSON, never a raw traceback.
        print("Parse endpoint error:", e)
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
