import requests
import sys
from PIL import Image
import io

# Create a small dummy image
img = Image.new('RGB', (800, 600), color = (73, 109, 137))
buf = io.BytesIO()
img.save(buf, format='PNG')
image_bytes = buf.getvalue()

url = "http://127.0.0.1:8000/parse"
files = {'file': ('test.png', image_bytes, 'image/png')}
data = {'prompt': 'Click on something'}

try:
    response = requests.post(url, files=files, data=data)
    print("Status Code:", response.status_code)
    print("Response JSON:", response.json())
except Exception as e:
    print("Error:", e)
