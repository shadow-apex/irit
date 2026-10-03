import sys
import os
import argparse
import json

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['sleep', 'shutdown', 'restart'])
    args = parser.parse_args()

    try:
        if args.action == 'sleep':
            os.system('rundll32.exe powrprof.dll,SetSuspendState 0,1,0')
            print(json.dumps({"status": "success", "message": "Sleeping PC."}))
        elif args.action == 'shutdown':
            os.system('shutdown /s /t 0')
            print(json.dumps({"status": "success", "message": "Shutting down PC."}))
        elif args.action == 'restart':
            os.system('shutdown /r /t 0')
            print(json.dumps({"status": "success", "message": "Restarting PC."}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    main()
