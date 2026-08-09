"""
tools/lock_screen.py

Khoa man hinh Windows ngay lap tuc, dung ham LockWorkStation() cua
user32.dll qua ctypes (khong can cai them gi).

Vi du dung:
    python tools/lock_screen.py
"""
import sys
import io
import json
import ctypes

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

if __name__ == "__main__":
    ok = ctypes.windll.user32.LockWorkStation()
    if ok:
        print(json.dumps({"success": True, "message": "Da khoa man hinh."}))
    else:
        print(json.dumps({"success": False, "error": "LockWorkStation() that bai."}))
