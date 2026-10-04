"""tools/lock_screen.py — khoá màn hình Windows ngay (LockWorkStation)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

if __name__ == "__main__":
    _common.ensure_utf8()
    import ctypes

    if ctypes.windll.user32.LockWorkStation():
        _common.emit(True, message="Đã khoá màn hình.")
    _common.fail("LockWorkStation() thất bại.")
