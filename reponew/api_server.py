import os
import io
import base64
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
import uvicorn
from PIL import Image
import torch
import google.generativeai as genai

from util.utils import check_ocr_box, get_yolo_model, get_som_labeled_img

app = FastAPI()

print("Loading YOLO Model...")
yolo_model = get_yolo_model()
print("YOLO Model Loaded!")

@app.post("/parse")
async def parse_image(file: UploadFile = File(...), prompt: str = Form(None)):
    image_bytes = await file.read()
    image_input = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    
    # 1. OCR (PaddleOCR if available)
    try:
        ocr_bbox_rslt, _ = check_ocr_box(
            image_input, 
            display_img=False, 
            output_bb_format='xyxy', 
            goal_filtering=None, 
            easyocr_args={'paragraph': False, 'text_threshold':0.9}, 
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

    # Pass use_local_semantics=False to bypass florence2/blip2
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
    if not prompt or not api_key:
        return JSONResponse({
            "labeled_image_base64": dino_labled_img,
            "coordinates": label_coordinates,
            # "parsed_content": parsed_content_list
        })
    
    # 3. If prompt is provided, ask Gemini Free API
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        labeled_pil = Image.open(io.BytesIO(base64.b64decode(dino_labled_img)))
        
        gemini_prompt = f"""
        You are an AI assistant helping to control a computer. 
        Here is a screenshot of the user's screen with numbered bounding boxes.
        The user's request is: "{prompt}"
        
        Based on the image, which box number (ID) should be clicked to fulfill this request?
        Return ONLY the box ID (a number) and nothing else. If you cannot find it, return -1.
        """
        
        response = model.generate_content([gemini_prompt, labeled_pil])
        target_id = response.text.strip()
        
        # Calculate center of target ID
        target_coords = label_coordinates.get(target_id)
        if target_coords:
            # target_coords is [xmin_ratio, ymin_ratio, w_ratio, h_ratio] from xywh out_fmt="xywh"
            x, y, w, h = target_coords
            center_x = x + (w / 2)
            center_y = y + (h / 2)
            
            return JSONResponse({
                "target_id": target_id,
                "target_center": [center_x, center_y],
                "coordinates": label_coordinates
            })
            
        return JSONResponse({
            "target_id": target_id,
            "error": "Target ID not found in coordinates",
            "coordinates": label_coordinates
        })
    except Exception as e:
        return JSONResponse({
            "error": str(e),
            "coordinates": label_coordinates
        })

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
