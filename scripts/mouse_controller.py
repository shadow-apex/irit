import sys
import pyautogui
import json
import time

def move_and_click(x_ratio, y_ratio):
    try:
        # Lấy kích thước màn hình hiện tại
        screen_width, screen_height = pyautogui.size()
        
        # Tính toán tọa độ thực tế từ ratio (0 -> 1)
        target_x = int(float(x_ratio) * screen_width)
        target_y = int(float(y_ratio) * screen_height)
        
        # Di chuyển mượt mà tới tọa độ trong 0.5s để người dùng dễ nhìn thấy
        pyautogui.moveTo(target_x, target_y, duration=0.5)
        
        # Thực hiện Click
        pyautogui.click()
        
        print(json.dumps({"success": True, "x": target_x, "y": target_y}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Missing coordinates (x_ratio, y_ratio)"}))
        sys.exit(1)
    
    x = sys.argv[1]
    y = sys.argv[2]
    move_and_click(x, y)
