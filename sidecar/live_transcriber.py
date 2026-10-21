"""
sidecar/live_transcriber.py — pipeline STREAMING cho Dịch (Alt+T) và Nhắc bài (Alt+A).

NÂNG CẤP TẬN GỐC so với bản cũ (batch 4 giây + faster-whisper độc lập từng
đoạn): đây là "Phương án A" đã thống nhất với người dùng — cloud streaming STT
(Deepgram Nova-3) cho từng nguồn âm thanh, thay cho việc cắt cứng theo giây.

Tóm tắt luồng xử lý mới:
  1) Ghi âm mic + loopback LIÊN TỤC bằng các khối nhỏ (~100ms/khối) thay vì
     gom đủ 4 giây mới xử lý — không còn "đợi hết chunk mới nghe".
  2) Mỗi nguồn (mic = "[Bạn]", loopback = "[Đối tác]") mở 1 kết nối WebSocket
     streaming RIÊNG tới Deepgram (model nova-3, language=vi), gửi audio gần
     như ngay khi ghi được.
  3) Deepgram tự làm VAD + "endpointing": khi phát hiện người nói vừa dừng lại
     (khoảng lặng ngắn, mặc định 400ms, chỉnh qua IRIS_STT_ENDPOINTING_MS),
     nó trả về transcript đã "chốt câu" (is_final + speech_final) — CHỐT
     THEO Ý, không chốt cứng theo giây như bản cũ. Đây là lý do chính giúp
     giảm việc câu bị cắt cụt và giảm độ trễ so với chờ đủ 4 giây.
  4) Khi có 1 đoạn được chốt, in ra ĐÚNG format cũ:
         [TRANSCRIPT] [Bạn] ...   hoặc   [TRANSCRIPT] [Đối tác] ...
     để electron/main.mjs không cần đổi cách đọc stdout.
  5) Nếu thiếu DEEPGRAM_API_KEY, hoặc Deepgram lỗi kết nối liên tục (vd. rớt
     mạng) sau nhiều lần thử lại, kênh đó TỰ ĐỘNG rớt về lại pipeline cũ
     (faster-whisper cục bộ, batch 4 giây) cho phần còn lại của phiên — để
     tính năng không bị câm hoàn toàn khi cloud không dùng được. Đây là cơ
     chế fallback tương đương với fallback Claude -> Gemini đã có ở phía
     main.mjs cho Nhắc bài.

Biến môi trường liên quan (xem .env.example):
  DEEPGRAM_API_KEY          — bắt buộc để dùng streaming cloud (nếu trống,
                               dùng luôn chế độ dự phòng cục bộ).
  IRIS_STT_LANGUAGE         — mặc định "vi".
  IRIS_STT_ENDPOINTING_MS   — độ dài khoảng lặng (ms) để Deepgram chốt câu.
                               Mặc định 400. Giảm xuống -> chốt câu nhanh hơn
                               (độ trễ thấp hơn) nhưng dễ cắt cụt câu nói
                               nhanh; tăng lên -> mượt hơn nhưng trễ hơn.
  IRIS_STT_UTTERANCE_END_MS — dự phòng cho trường hợp speech_final không bắn
                               kịp (xem UtteranceEnd bên dưới). Mặc định 1000.
  IRIS_STT_MAX_RECONNECTS   — số lần thử nối lại Deepgram trước khi rớt về
                               chế độ dự phòng cục bộ. Mặc định 5.
  IRIS_STT_DEBUG            — set "1" để in toàn bộ message thô từ Deepgram
                               ra stderr (chẩn đoán khi field khác với tài
                               liệu đã tra cứu).

LƯU Ý TRUNG THỰC: phần gọi Deepgram thực tế (network) chưa được test end-to-end
bằng mic/loa thật trong lúc viết code này (môi trường viết code không có thiết
bị âm thanh và không gọi được ra ngoài tới Deepgram) — cấu trúc field
(is_final/speech_final/channel.alternatives[0].transcript, tên tham số
connect(), send_media/send_close_stream...) đã được đối chiếu trực tiếp với
mã nguồn gói `deepgram-sdk` (bản 7.6.0) cài thử, không phải đoán từ trí nhớ.
Vẫn nên chạy thử thật (Alt+T, nói vài câu) và xem log stderr trước khi tin
tưởng hoàn toàn — xem NANG_CAP_MOI.md / báo cáo đi kèm.
"""

import sys
import os
import time
import queue
import asyncio
import threading
import warnings

# Tắt cảnh báo SoundcardRuntimeWarning gây tràn log và crash trên Windows
warnings.filterwarnings("ignore")

import numpy as np
import soundcard as sc
try:
    warnings.filterwarnings("ignore", category=sc.SoundcardRuntimeWarning)
    warnings.simplefilter("ignore")
except Exception:
    pass

# --------------------------------------------------------------------------
# Cấu hình
# --------------------------------------------------------------------------

SAMPLE_RATE = 16000
FRAME_MS = 100  # gửi mỗi ~100ms audio một lần (thay vì gom đủ 4s) -> độ trễ ghi âm gần như 0
FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)
MAX_QUEUE_FRAMES = 50  # ~5s đệm phòng khi mạng chậm/đang thử nối lại

DEEPGRAM_API_KEY = (os.environ.get("DEEPGRAM_API_KEY") or "").strip()
STT_LANGUAGE = (os.environ.get("IRIS_STT_LANGUAGE") or "vi").strip()
ENDPOINTING_MS = int(os.environ.get("IRIS_STT_ENDPOINTING_MS") or 400)
UTTERANCE_END_MS = int(os.environ.get("IRIS_STT_UTTERANCE_END_MS") or 1000)
MAX_RECONNECT_ATTEMPTS = int(os.environ.get("IRIS_STT_MAX_RECONNECTS") or 5)
STT_DEBUG = (os.environ.get("IRIS_STT_DEBUG") or "").strip() == "1"

# Batch cũ (chỉ dùng khi rớt về chế độ dự phòng cục bộ)
FALLBACK_CHUNK_SECONDS = 4
FALLBACK_SILENCE_RMS_THRESHOLD = 0.006


# --------------------------------------------------------------------------
# Tiện ích xử lý audio (dùng chung cho cả 2 chế độ)
# --------------------------------------------------------------------------

def to_mono_float(raw_audio: np.ndarray) -> np.ndarray:
    """(frames, channels) float32 -> mono float32."""
    if raw_audio.ndim > 1:
        return np.mean(raw_audio, axis=1).astype(np.float32)
    return raw_audio.astype(np.float32)


def to_pcm16_bytes(mono_float: np.ndarray) -> bytes:
    """mono float32 trong [-1, 1] -> PCM16 bytes (linear16) cho Deepgram."""
    clipped = np.clip(mono_float, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16).tobytes()


def normalize_peak(mono, target_peak=0.9):
    """Giữ nguyên logic chuẩn hoá biên độ của bản cũ — chỉ dùng ở chế độ dự
    phòng (Whisper cục bộ vẫn cần vì không tự AGC như Deepgram)."""
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    if peak < 1e-6:
        return mono
    gain = min(target_peak / peak, 10.0)
    return (mono * gain).astype(np.float32)


# --------------------------------------------------------------------------
# Whisper cục bộ — CHỈ tải khi thật sự cần (thiếu key hoặc cloud lỗi liên
# tục), để không tốn RAM/thời gian khởi động khi cloud streaming chạy tốt.
# --------------------------------------------------------------------------

_fallback_model = None
_fallback_model_lock = threading.Lock()


def get_fallback_model():
    global _fallback_model
    with _fallback_model_lock:
        if _fallback_model is None:
            from faster_whisper import WhisperModel

            whisper_model = (os.environ.get("IRIS_WHISPER_MODEL") or "small").strip()
            print(f"[FALLBACK] Đang tải model Whisper cục bộ ({whisper_model}, dự phòng)...", file=sys.stderr, flush=True)
            cpu_cores = os.cpu_count() or 4
            _fallback_model = WhisperModel(whisper_model, device="cpu", compute_type="int8", cpu_threads=cpu_cores)
            print("[FALLBACK] Model Whisper cục bộ đã sẵn sàng.", file=sys.stderr, flush=True)
        return _fallback_model


# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Gemini 2.5 Flash Cloud Audio STT (Dự phòng thông minh khi thiếu Deepgram)
# --------------------------------------------------------------------------

def get_gemini_keys():
    keys = []
    env_vars = [
        "GEMINI_TELEPROMPTER_API_KEY",
        "GEMINI_MEETING_API_KEY",
        "GEMINI_API_KEY_MEETING",
        "GEMINI_API_KEY",
        "GEMINI_API_KEYS",
        "GEMINI_LIVE_API_KEY",
        "GEMINI_API_KEY_LIVE",
        "GEMINI_VISION_API_KEY",
        "GEMINI_API_KEY_VISION",
    ] + [f"GEMINI_API_KEY_STANDBY_{i}" for i in range(1, 8)]

    for var in env_vars:
        val = os.environ.get(var) or ""
        for raw in val.replace("\r", "\n").split("\n"):
            for part in raw.split(","):
                k = part.strip().strip('"').strip("'")
                if k and len(k) > 20 and k not in keys:
                    keys.append(k)

    if not keys:
        for env_file in [".env", os.path.join(os.path.dirname(__file__), "..", ".env")]:
            if os.path.exists(env_file):
                try:
                    with open(env_file, "r", encoding="utf-8") as f:
                        for line in f:
                            if any(line.strip().startswith(v + "=") for v in env_vars):
                                val = line.strip().split("=", 1)[1]
                                for raw in val.replace("\r", "\n").split("\n"):
                                    for part in raw.split(","):
                                        k = part.strip().strip('"').strip("'")
                                        if k and len(k) > 20 and k not in keys:
                                            keys.append(k)
                except Exception:
                    pass
    return keys

GEMINI_STT_KEYS = get_gemini_keys()
_gemini_key_idx = 0
_gemini_key_lock = threading.Lock()
_client_cache = {}
_client_cache_lock = threading.Lock()

def get_cached_genai_client(api_key: str):
    with _client_cache_lock:
        if api_key not in _client_cache:
            if len(_client_cache) >= 20:
                _client_cache.clear()
            from google import genai
            _client_cache[api_key] = genai.Client(api_key=api_key)
        return _client_cache[api_key]


def transcribe_gemini_audio(mono_float: np.ndarray, sample_rate: int = 16000) -> str | None:
    """Gửi batch audio tới Gemini 2.5 Flash Audio API. 0% CPU, độ trễ ~1.5s."""
    global _gemini_key_idx
    if not GEMINI_STT_KEYS:
        return None
    try:
        import io
        import wave
        from google import genai
        from google.genai import types

        clipped = np.clip(mono_float, -1.0, 1.0)
        pcm16 = (clipped * 32767.0).astype(np.int16).tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm16)
        wav_bytes = buf.getvalue()

        for _ in range(min(len(GEMINI_STT_KEYS), 3)):
            with _gemini_key_lock:
                key = GEMINI_STT_KEYS[_gemini_key_idx % len(GEMINI_STT_KEYS)]
            try:
                client = get_cached_genai_client(key)
                prompt = (
                    "Chép lại lời nói (transcribe) trong file âm thanh này bằng tiếng Việt. "
                    "Chỉ trả về văn bản lời nói chính xác, tuyệt đối không giải thích hay thêm định dạng thừa. "
                    "Nếu là im lặng hoặc tiếng ồn không có lời nói, chỉ trả về chuỗi rỗng."
                )
                candidate_models = [
                    os.environ.get("GEMINI_STT_MODEL", "").strip(),
                    "gemini-2.0-flash",
                    "gemini-1.5-flash",
                    "gemini-2.5-flash",
                    "gemini-flash-latest",
                ]
                candidate_models = [m for m in candidate_models if m]
                resp = None
                last_model_err = None
                for m_name in candidate_models:
                    try:
                        resp = client.models.generate_content(
                            model=m_name,
                            contents=[
                                types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"),
                                prompt,
                            ],
                        )
                        break
                    except Exception as m_err:
                        last_model_err = m_err
                        m_err_str = str(m_err)
                        if "429" in m_err_str or "RESOURCE_EXHAUSTED" in m_err_str:
                            raise m_err
                        # 404/400 do model bị gỡ/không hỗ trợ audio ⇒ thử model kế tiếp (đồng bộ với phía Electron)
                        if any(w in m_err_str for w in ["404", "NOT_FOUND", "not found", "is not supported", "deprecated", "no longer available", "400", "INVALID_ARGUMENT"]):
                            continue
                        raise m_err
                if resp is None:
                    raise last_model_err or Exception("All Gemini STT models failed")
                text = (resp.text or "").strip()
                if text.startswith("```") and text.endswith("```"):
                    text = text.strip("`").strip()
                return text
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    with _gemini_key_lock:
                        _gemini_key_idx = (_gemini_key_idx + 1) % len(GEMINI_STT_KEYS)
                    continue
                else:
                    with _gemini_key_lock:
                        _gemini_key_idx = (_gemini_key_idx + 1) % len(GEMINI_STT_KEYS)
                    return None
    except Exception as e:
        print(f"[Gemini Cloud STT] Không thể xử lý audio: {e}", file=sys.stderr, flush=True)
        return None
    return None

# Một nguồn âm thanh (mic của bạn HOẶC loopback loa/đối tác)
# --------------------------------------------------------------------------

class AudioChannel:
    def __init__(self, label, device):
        self.label = label  # "Bạn" hoặc "Đối tác" — GIỮ NGUYÊN nhãn cũ
        self.device = device
        self.raw_queue = queue.Queue(maxsize=MAX_QUEUE_FRAMES)  # thread ghi âm -> vòng lặp async
        self.stop_event = threading.Event()
        self.capture_thread = None
        self.mode = "cloud" if DEEPGRAM_API_KEY else "fallback"
        self._final_acc = ""  # gom các mẩu is_final=True chưa "chốt câu" hẳn

    # ---- Ghi âm: chạy trong thread riêng vì soundcard.record() là blocking ----
    def start_capture(self):
        self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.capture_thread.start()

    def _capture_loop(self):
        try:
            with self.device.recorder(samplerate=SAMPLE_RATE, blocksize=FRAME_SAMPLES) as recorder:
                while not self.stop_event.is_set():
                    data = recorder.record(numframes=FRAME_SAMPLES)
                    try:
                        self.raw_queue.put_nowait(data)
                    except queue.Full:
                        # Đầy thì bỏ khối cũ nhất, ưu tiên độ trễ thấp hơn là
                        # giữ đủ dữ liệu cũ (giống triết lý bản gốc).
                        try:
                            self.raw_queue.get_nowait()
                        except queue.Empty:
                            pass
                        try:
                            self.raw_queue.put_nowait(data)
                        except queue.Full:
                            pass
        except Exception as e:
            print(f"[{self.label}] Lỗi ghi âm: {e}", file=sys.stderr, flush=True)

    def _next_raw_frame(self):
        try:
            return self.raw_queue.get_nowait()
        except queue.Empty:
            return None

    def emit(self, text):
        text = (text or "").strip()
        if text:
            print(f"[TRANSCRIPT] [{self.label}] {text}", flush=True)

    # ---- Chế độ cloud: Deepgram streaming (Nova-3) --------------------------
    #
    # LƯU Ý THIẾT KẾ (quan trọng, tránh 1 lỗi tinh vi): bộ đếm `attempts` chỉ
    # được reset về 0 sau khi kết nối đã CHỨNG MINH là khoẻ mạnh — tức đứng
    # vững ít nhất HEALTHY_CONNECTION_SECONDS giây — chứ KHÔNG phải ngay khi
    # socket vừa mở. Nếu reset ngay lúc mở socket, một API key sai hoặc model
    # không hợp lệ (kiểu lỗi mở được kết nối rồi bị server từ chối gần như
    # ngay lập tức) sẽ khiến vòng lặp mở-rồi-lỗi-rồi-mở-lại LẶP VÔ HẠN mà
    # KHÔNG BAO GIỜ chạm ngưỡng MAX_RECONNECT_ATTEMPTS để rớt về dự phòng —
    # đúng kiểu lỗi "tưởng có fallback nhưng thực ra treo im lặng mãi mãi".
    HEALTHY_CONNECTION_SECONDS = 3.0

    async def run_cloud(self):
        from deepgram import AsyncDeepgramClient
        from deepgram.core.events import EventType

        attempts = 0
        client = AsyncDeepgramClient(api_key=DEEPGRAM_API_KEY)

        while not self.stop_event.is_set():
            conn_closed = asyncio.Event()
            connect_started_at = time.monotonic()
            try:
                async with client.listen.v1.connect(
                    model="nova-3",
                    language=STT_LANGUAGE,
                    encoding="linear16",
                    sample_rate=SAMPLE_RATE,
                    channels=1,
                    punctuate=True,
                    smart_format=True,
                    interim_results=True,
                    endpointing=ENDPOINTING_MS,
                    utterance_end_ms=UTTERANCE_END_MS,
                    vad_events=True,
                ) as connection:
                    self._final_acc = ""

                    def on_error(err):
                        print(f"[{self.label}] Deepgram lỗi khi đang chạy: {err}", file=sys.stderr, flush=True)
                        conn_closed.set()

                    def on_close(_evt):
                        conn_closed.set()

                    connection.on(EventType.MESSAGE, self._handle_message)
                    connection.on(EventType.ERROR, on_error)
                    connection.on(EventType.CLOSE, on_close)

                    listen_task = asyncio.create_task(connection.start_listening())

                    while not self.stop_event.is_set() and not conn_closed.is_set():
                        frame = self._next_raw_frame()
                        if frame is None:
                            await asyncio.sleep(0.02)
                            continue
                        mono = to_mono_float(frame)
                        await connection.send_media(to_pcm16_bytes(mono))

                    try:
                        await connection.send_close_stream()
                    except Exception:
                        pass
                    listen_task.cancel()
                    try:
                        await asyncio.wait_for(listen_task, timeout=1.0)
                    except (Exception, asyncio.CancelledError):
                        # Mong đợi CancelledError ở đây vì ta VỪA tự cancel() task
                        # này ở dòng trên — không phải lỗi thật, chỉ là cách asyncio
                        # báo "task đã dừng theo yêu cầu". asyncio.CancelledError
                        # không phải subclass của Exception (từ Python 3.8+) nên
                        # phải bắt riêng, nếu không nó sẽ văng lên và làm cả
                        # run_cloud() thoát sai chỗ.
                        pass

                if self.stop_event.is_set():
                    return  # dừng theo yêu cầu người dùng (Alt+T tắt) — không phải lỗi

                stayed_up_for = time.monotonic() - connect_started_at
                if stayed_up_for >= self.HEALTHY_CONNECTION_SECONDS:
                    attempts = 0  # kết nối đã chạy ổn một lúc rồi mới rớt -> coi như "khoẻ", reset bộ đếm
                else:
                    attempts += 1
                    print(
                        f"[{self.label}] Deepgram rớt kết nối chỉ sau {stayed_up_for:.1f}s "
                        f"(lần {attempts}/{MAX_RECONNECT_ATTEMPTS}).",
                        file=sys.stderr, flush=True,
                    )

            except Exception as e:
                attempts += 1
                print(f"[{self.label}] Deepgram lỗi kết nối (lần {attempts}/{MAX_RECONNECT_ATTEMPTS}): {e}",
                      file=sys.stderr, flush=True)

            if self.stop_event.is_set():
                return

            if attempts >= MAX_RECONNECT_ATTEMPTS:
                print(
                    f"[{self.label}] Deepgram lỗi {attempts} lần liên tiếp — chuyển sang chế độ DỰ PHÒNG "
                    f"cục bộ (faster-whisper, độ trễ sẽ cao hơn mục tiêu <1.5s) cho phần còn lại của phiên.",
                    file=sys.stderr, flush=True,
                )
                self.mode = "fallback"
                await self.run_fallback()
                return

            if attempts > 0:
                await asyncio.sleep(min(2 ** attempts, 10))  # backoff, tối đa 10s giữa các lần thử

    def _handle_message(self, message):
        if STT_DEBUG:
            print(f"[{self.label}][DEBUG] {message!r}", file=sys.stderr, flush=True)

        msg_type = getattr(message, "type", None)

        if msg_type == "UtteranceEnd":
            # Lưới an toàn: nếu vì lý do gì đó speech_final không bắn kịp
            # (vd. mạng chập chờn), UtteranceEnd vẫn đảm bảo đoạn đang gom
            # dở được "chốt" và hiển thị, thay vì treo mãi chờ speech_final.
            if self._final_acc.strip():
                self.emit(self._final_acc)
                self._final_acc = ""
            return

        if msg_type != "Results":
            return

        try:
            alt = message.channel.alternatives[0]
            transcript = (alt.transcript or "").strip()
        except Exception:
            return

        if not transcript:
            return

        is_final = bool(getattr(message, "is_final", False))
        speech_final = bool(getattr(message, "speech_final", False))

        if not is_final:
            return  # bỏ qua interim — bản này không hiển thị "chữ đang gõ dở"

        self._final_acc = f"{self._final_acc} {transcript}".strip()

        if speech_final:
            self.emit(self._final_acc)
            self._final_acc = ""

    # ---- Chế độ dự phòng: Gemini 2.5 Flash Cloud Audio -> Whisper cục bộ --------
    async def run_fallback(self):
        needed_samples = int(SAMPLE_RATE * FALLBACK_CHUNK_SECONDS)
        buf = []
        buf_samples = 0
        local_model = None

        while not self.stop_event.is_set():
            frame = self._next_raw_frame()
            if frame is None:
                await asyncio.sleep(0.05)
                continue

            buf.append(frame)
            buf_samples += frame.shape[0]
            if buf_samples < needed_samples:
                continue

            audio = np.concatenate(buf, axis=0)
            buf, buf_samples = [], 0

            mono = to_mono_float(audio)
            rms = float(np.sqrt(np.mean(mono ** 2))) if mono.size else 0.0
            if rms < FALLBACK_SILENCE_RMS_THRESHOLD:
                continue
            mono = normalize_peak(mono)

            # Ưu tiên 1: Gemini 2.5 Flash Cloud Audio (0% CPU, 0s startup)
            text = None
            if GEMINI_STT_KEYS:
                try:
                    text = await asyncio.to_thread(transcribe_gemini_audio, mono, SAMPLE_RATE)
                except Exception as e:
                    print(f"[{self.label}] Gemini STT fallback lỗi: {e}", file=sys.stderr, flush=True)

            # Ưu tiên 2: Rớt về faster-whisper cục bộ nếu Gemini không khả dụng
            if text is None:
                if local_model is None:
                    local_model = await asyncio.to_thread(get_fallback_model)
                try:
                    segments, _ = await asyncio.to_thread(
                        local_model.transcribe,
                        mono,
                        beam_size=5,
                        language="vi",
                        vad_filter=True,
                        vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=300),
                        condition_on_previous_text=False,
                        no_speech_threshold=0.6,
                    )
                    text = "".join(seg.text for seg in segments).strip()
                except Exception as e:
                    print(f"[{self.label}] Lỗi transcribe whisper dự phòng: {e}", file=sys.stderr, flush=True)
                    text = ""

            self.emit(text)

    async def run(self):
        if self.mode == "cloud":
            await self.run_cloud()
        else:
            await self.run_fallback()

    def stop(self):
        self.stop_event.set()


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

async def main_async():
    if not DEEPGRAM_API_KEY:
        if GEMINI_STT_KEYS:
            print(
                f"[CLOUD-FALLBACK] Không có DEEPGRAM_API_KEY — kích hoạt Gemini 2.5 Flash Audio API "
                f"({len(GEMINI_STT_KEYS)} keys trong Pool, 0% CPU, độ trễ ~1.5s).",
                file=sys.stderr,
                flush=True,
            )
        else:
            print(
                "[FALLBACK] Không thấy DEEPGRAM_API_KEY và không có Gemini Key — dùng chế độ dự phòng "
                "cục bộ (faster-whisper). Xem .env.example để bật streaming cloud.",
                file=sys.stderr,
                flush=True,
            )
    else:
        print(f"[CLOUD] Dùng Deepgram streaming (nova-3, language={STT_LANGUAGE}).", file=sys.stderr, flush=True)

    try:
        speaker = sc.default_speaker()
        loopback_mic = sc.get_microphone(speaker.id, include_loopback=True)
    except Exception as e:
        print(f"Loopback error: {e}", file=sys.stderr, flush=True)
        loopback_mic = None

    try:
        default_mic = sc.default_microphone()
    except Exception as e:
        print(f"Mic error: {e}", file=sys.stderr, flush=True)
        default_mic = None

    if loopback_mic is None and default_mic is None:
        print("No audio devices found.", file=sys.stderr, flush=True)
        sys.exit(1)

    channels = []
    if default_mic:
        channels.append(AudioChannel("Bạn", default_mic))
    if loopback_mic:
        channels.append(AudioChannel("Đối tác", loopback_mic))

    for ch in channels:
        ch.start_capture()

    loop = asyncio.get_running_loop()
    stop_flag = asyncio.Event()

    def listen_stdin():
        while True:
            line = sys.stdin.readline()
            if not line or line.strip() == "stop":
                loop.call_soon_threadsafe(stop_flag.set)
                break
            time.sleep(0.1)

    threading.Thread(target=listen_stdin, daemon=True).start()

    # Không cần tải model nặng trước khi báo READY nữa (Whisper giờ lazy-load
    # chỉ khi thật sự rớt về dự phòng) -> khởi động nhanh hơn hẳn bản cũ.
    print("READY", flush=True)

    run_tasks = [asyncio.create_task(ch.run()) for ch in channels]

    await stop_flag.wait()
    for ch in channels:
        ch.stop()

    # Cho các task chút thời gian đóng kết nối cho gọn trước khi bị
    # main.mjs SIGKILL (nó đợi tối đa 3000ms) — xem stopSidecar() ở main.mjs.
    done, pending = await asyncio.wait(run_tasks, timeout=2.0)
    for t in pending:
        t.cancel()

    print("STOPPED", flush=True)


def main():
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
