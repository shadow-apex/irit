"""
tools/idle_time.py

Bao thoi gian (giay) tu lan cuoi co thao tac ban phim/chuot, dung Windows
API GetLastInputInfo qua ctypes (khong can cai them thu vien nao).

FIX (2026):
  - Truoc day dung GetTickCount() (tra ve DWORD 32-bit) MA KHONG set
    .restype -> ctypes mac dinh hieu ham tra ve la 'int' CO DAU 32-bit.
    Sau ~24.8 ngay may chay lien tuc (khi bit cao nhat cua tick count bi
    bat), gia tri nay bi doc thanh SO AM, lam phep tru
    (tick_count - lii.dwTime) ra ket qua sai/am. Nay chuyen sang dung
    GetTickCount64() (ULONGLONG, thuc te khong bao gio tran trong doi
    nguoi) va set .restype dung.
  - Them try/except o __main__ (truoc day khong co).

Vi du dung:
    python tools/idle_time.py
"""
import sys
import io
import json
import ctypes
from ctypes import wintypes

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def get_idle_seconds():
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    lii = LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
    if not user32.GetLastInputInfo(ctypes.byref(lii)):
        return {"success": False, "error": "GetLastInputInfo() that bai."}

    # GetTickCount64 tra ve ULONGLONG (khong tran trong doi nguoi), khac
    # GetTickCount() (DWORD 32-bit, tran sau ~49.7 ngay). dwTime cua
    # LASTINPUTINFO van la 32-bit (tick count tai thoi diem nhap lieu cuoi),
    # nen ta lay 32 bit thap cua tick64 hien tai de tru cho dung, kem xu ly
    # tran so (wraparound) an toan bang phep AND voi 0xFFFFFFFF.
    kernel32.GetTickCount64.restype = ctypes.c_ulonglong
    tick64 = kernel32.GetTickCount64()
    now_low32 = tick64 & 0xFFFFFFFF
    idle_ms = (now_low32 - lii.dwTime) & 0xFFFFFFFF
    return {"success": True, "idle_seconds": round(idle_ms / 1000.0, 1)}


if __name__ == "__main__":
    try:
        result = get_idle_seconds()
    except Exception as e:
        result = {"success": False, "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("success") else 1)
