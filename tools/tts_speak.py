"""
tools/tts_speak.py

Doc to mot doan van ban bang giong noi OFFLINE (khong can mang, khong ton
token Gemini/API). Dung pyttsx3 (chay tren SAPI5 co san cua Windows) — can
cai them qua tools/requirements.txt.

Vi du dung:
    python tools/tts_speak.py "Xin chao, toi la tro ly cua ban"
    python tools/tts_speak.py "Hello there" --rate 180 --volume 0.8
    python tools/tts_speak.py --list-voices
"""
import sys
import io
import json
import argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

try:
    import pyttsx3
except ImportError:
    print(json.dumps({"success": False, "error": "Thieu thu vien pyttsx3. Chay: pip install -r tools/requirements.txt"}))
    sys.exit(1)


def list_voices():
    engine = pyttsx3.init()
    voices = engine.getProperty("voices")
    return {"success": True, "voices": [
        {"id": v.id, "name": v.name, "languages": list(getattr(v, "languages", []) or [])}
        for v in voices
    ]}


def speak(text, rate=None, volume=None, voice_id=None):
    engine = pyttsx3.init()
    if rate is not None:
        engine.setProperty("rate", rate)
    if volume is not None:
        engine.setProperty("volume", max(0.0, min(1.0, volume)))
    if voice_id:
        engine.setProperty("voice", voice_id)
    engine.say(text)
    engine.runAndWait()
    return {"success": True, "message": f"Da doc xong {len(text)} ky tu."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Doc to van ban bang giong offline")
    parser.add_argument("text", type=str, nargs="?", help="Van ban can doc")
    parser.add_argument("--rate", type=int, default=None, help="Toc do noi (tu/phut), mac dinh he thong (~200)")
    parser.add_argument("--volume", type=float, default=None, help="Am luong 0.0-1.0")
    parser.add_argument("--voice-id", type=str, default=None, help="ID giong noi (xem --list-voices)")
    parser.add_argument("--list-voices", action="store_true", help="Liet ke cac giong noi co san tren may")
    args = parser.parse_args()

    try:
        if args.list_voices:
            print(json.dumps(list_voices(), ensure_ascii=False))
        elif args.text:
            print(json.dumps(speak(args.text, args.rate, args.volume, args.voice_id), ensure_ascii=False))
        else:
            print(json.dumps({"success": False, "error": "Thieu van ban can doc (hoac dung --list-voices)."}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
