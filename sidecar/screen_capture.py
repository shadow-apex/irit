"""
sidecar/screen_capture.py

Fallback screen capture for Windows using Pillow (ImageGrab) with Desktop Attachment.
Used by electron/main/vision.mjs when Electron's desktopCapturer fails to attach
to the desktop on Windows (error 170 / empty thumbnail).
"""
import sys
import ctypes
import io
from PIL import ImageGrab

def main():
    width = int(sys.argv[1]) if len(sys.argv) > 1 else 1280
    height = int(sys.argv[2]) if len(sys.argv) > 2 else 720
    quality = int(sys.argv[3]) if len(sys.argv) > 3 else 50

    if sys.platform == "win32":
        try:
            user32 = ctypes.windll.user32
            desk = user32.OpenInputDesktop(0, False, 0x01ff)
            if desk:
                user32.SetThreadDesktop(desk)
        except Exception:
            pass

    try:
        img = ImageGrab.grab(all_screens=True) if sys.platform == "win32" else ImageGrab.grab()
        img.thumbnail((width, height))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        sys.stdout.buffer.write(buf.getvalue())
        sys.stdout.buffer.flush()
    except Exception as e:
        sys.stderr.write(f"Screen capture failed: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
