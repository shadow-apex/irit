import cv2
import json
import numpy as np

# Load the generated image
img = cv2.imread(r"C:\Users\vanha\.gemini\antigravity\brain\5c5c7699-7f85-4ccc-a9cf-06b9c0d7c1a4\gojo_lineart_1786450635836.jpg", cv2.IMREAD_GRAYSCALE)

# Threshold to get binary image (black lines on white)
_, binary = cv2.threshold(img, 128, 255, cv2.THRESH_BINARY_INV)

# Find contours
contours, hierarchy = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_TC89_KCOS)

paths = []
# Get center
h, w = binary.shape
cx, cy = w / 2.0, h / 2.0

for contour in contours:
    # Filter out tiny noise contours
    if len(contour) > 5:
        path = []
        for point in contour:
            x, y = point[0]
            # Center the coordinates around (0,0) so it can be scaled by mouse_control.py
            # Normalize to [-0.5, 0.5] range
            nx = (x - cx) / w
            ny = (y - cy) / h
            path.append((nx, ny))
        paths.append(path)

# Save to gojo_paths.json
out_path = r"C:\Users\vanha\Downloads\irit-fixed\irit\tools\gojo_paths.json"
with open(out_path, "w") as f:
    json.dump(paths, f)

print(f"Extracted {len(paths)} paths and saved to {out_path}")
