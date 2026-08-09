import os
import sys
import argparse
import json
import glob

VID_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "videos")
STATE_FILE = os.path.join(VID_DIR, "state.json")

def get_video_files():
    if not os.path.exists(VID_DIR):
        return []
    files = glob.glob(os.path.join(VID_DIR, "*.mp4")) + glob.glob(os.path.join(VID_DIR, "*.avi"))
    # Sắp xếp mới nhất lên đầu
    files.sort(key=os.path.getmtime, reverse=True)
    return files

def play_video(action):
    files = get_video_files()
    if not files:
        print(json.dumps({"success": False, "error": "Không tìm thấy video nào."}))
        return

    current_index = 0
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                state = json.load(f)
                current_index = state.get("index", 0)
        except:
            pass

    if action == "latest":
        current_index = 0
    elif action == "prev": # older
        current_index = min(current_index + 1, len(files) - 1)
    elif action == "next": # newer
        current_index = max(current_index - 1, 0)
    elif action == "close":
        os.system("taskkill /f /im Video.UI.exe >nul 2>&1")
        os.system("taskkill /f /im wmplayer.exe >nul 2>&1")
        print(json.dumps({"success": True, "message": "Đã cố gắng đóng các trình phát video mặc định."}))
        return

    with open(STATE_FILE, 'w') as f:
        json.dump({"index": current_index}, f)

    target_file = files[current_index]
    try:
        os.startfile(target_file)
        print(json.dumps({"success": True, "message": f"Đã mở video: {os.path.basename(target_file)}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Không thể mở video: {str(e)}"}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=['latest', 'prev', 'next', 'close'], required=True)
    args = parser.parse_args()
    
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    play_video(args.action)
