import pyautogui
import os
import argparse
from datetime import datetime
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def take_screenshot(output_dir="."):
    """Chụp ảnh màn hình và lưu vào thư mục chỉ định"""
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"screenshot_{timestamp}.png"
    filepath = os.path.abspath(os.path.join(output_dir, filename))
    
    print("Đang chụp ảnh màn hình...")
    # Chụp toàn bộ màn hình
    screenshot = pyautogui.screenshot()
    screenshot.save(filepath)
    
    print(f"Thành công! Ảnh màn hình đã được lưu tại: {filepath}")
    # Trả về đường dẫn tuyệt đối cho AI có thể đọc
    return filepath

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Công cụ Con mắt AI (Chụp ảnh màn hình)")
    parser.add_argument("--outdir", type=str, help="Thư mục lưu ảnh", default=".")
    
    args = parser.parse_args()
    
    take_screenshot(args.outdir)
