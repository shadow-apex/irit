import sys
import json
import argparse
import time
try:
    import pyautogui
except ImportError:
    import os
    os.system(f'{sys.executable} -m pip install pyautogui')
    import pyautogui

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['new', 'close', 'left', 'right', 'boss'])
    args = parser.parse_args()

    try:
        if args.action == 'new':
            pyautogui.hotkey('win', 'ctrl', 'd')
            print(json.dumps({"status": "success", "message": "Created new virtual desktop."}))
        elif args.action == 'close':
            pyautogui.hotkey('win', 'ctrl', 'f4')
            print(json.dumps({"status": "success", "message": "Closed current virtual desktop."}))
        elif args.action == 'left':
            pyautogui.hotkey('win', 'ctrl', 'left')
            print(json.dumps({"status": "success", "message": "Switched to left virtual desktop."}))
        elif args.action == 'right':
            pyautogui.hotkey('win', 'ctrl', 'right')
            print(json.dumps({"status": "success", "message": "Switched to right virtual desktop."}))
        elif args.action == 'boss':
            pyautogui.hotkey('win', 'd')
            print(json.dumps({"status": "success", "message": "Triggered Boss Key (Show Desktop)."}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    main()
