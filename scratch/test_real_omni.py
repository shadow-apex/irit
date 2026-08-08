import requests
import io
from PIL import Image, ImageDraw, ImageText

print("Creating dummy image...")
img = Image.new('RGB', (800, 600), color = (255, 255, 255))
d = ImageDraw.Draw(img)
d.rectangle([10, 550, 100, 590], fill=(0, 0, 255)) # fake start button
# Not using text to avoid missing font issues, just drawing a blue rectangle.
buf = io.BytesIO()
img.save(buf, format='PNG')
image_bytes = buf.getvalue()

url = "http://127.0.0.1:8001/parse"
files = {'file': ('screenshot.png', image_bytes, 'image/png')}
data = {'prompt': 'click the blue rectangle at the bottom left'}

print("Sending to OmniParser API...")
try:
    response = requests.post(url, files=files, data=data, timeout=60)
    print("Status Code:", response.status_code)
    try:
        json_resp = response.json()
        if "labeled_image_base64" in json_resp:
            json_resp["labeled_image_base64"] = "<base64_hidden_for_brevity>"
        print("Response JSON:", json_resp)
    except Exception as je:
        print("Failed to parse JSON:", je)
        print("Raw text:", response.text)
except Exception as e:
    print("Error calling API:", e)
