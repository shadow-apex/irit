import sys
import json
import argparse
try:
    import pyautogui
except ImportError:
    import os
    os.system(f'{sys.executable} -m pip install pyautogui')
    import pyautogui

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['playpause', 'next', 'prev'])
    args = parser.parse_args()

    try:
        if args.action == 'playpause':
            pyautogui.press('playpause')
            print(json.dumps({"status": "success", "message": "Toggled play/pause."}))
        elif args.action == 'next':
            pyautogui.press('nexttrack')
            print(json.dumps({"status": "success", "message": "Skipped to next track."}))
        elif args.action == 'prev':
            pyautogui.press('prevtrack')
            print(json.dumps({"status": "success", "message": "Returned to previous track."}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    main()
