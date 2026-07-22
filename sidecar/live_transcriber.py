import sys
import threading
import queue
import time
import numpy as np
import soundcard as sc
from faster_whisper import WhisperModel

recording = True

# Giới hạn queue để tránh phình vô hạn nếu transcribe chậm hơn
# tốc độ ghi âm thực (bản cũ dùng Queue() không giới hạn -> leak RAM).
MAX_QUEUE_CHUNKS = 5


CHUNK_SECONDS = 4  # tăng từ 3 -> 4s: giảm số lần một từ bị cắt ngang ở ranh giới chunk
SILENCE_RMS_THRESHOLD = 0.006  # dưới ngưỡng này coi như im lặng, không đưa vào Whisper (tránh hallucination)


def record_stream(mic, frames_queue, sample_rate):
    try:
        with mic.recorder(samplerate=sample_rate) as recorder:
            while recording:
                data = recorder.record(numframes=int(sample_rate * CHUNK_SECONDS))
                try:
                    frames_queue.put(data, block=False)
                except queue.Full:
                    # Bỏ chunk cũ nhất để nhường chỗ cho chunk mới, thay vì
                    # để queue phình to vô hạn (ưu tiên độ trễ thấp hơn
                    # là giữ đủ dữ liệu cũ khi máy đuối).
                    try:
                        frames_queue.get_nowait()
                    except queue.Empty:
                        pass
                    frames_queue.put(data, block=False)
    except Exception as e:
        print(f"Error recording from {mic.name}: {e}", file=sys.stderr)


def drain_all(q):
    """Lấy hết mọi chunk đang có trong queue (thay vì chỉ 1 item/lượt
    như bản cũ, vốn khiến queue tồn đọng dần khi transcribe chậm)."""
    items = []
    while True:
        try:
            items.append(q.get_nowait())
        except queue.Empty:
            break
    return items


def to_mono(audio):
    """audio có shape (frames, channels) -> mono float32."""
    if audio.ndim > 1:
        return np.mean(audio, axis=1).astype(np.float32)
    return audio.astype(np.float32)


def normalize_peak(mono, target_peak=0.9):
    """Chuẩn hóa biên độ về gần target_peak để Whisper (và VAD nội bộ của nó)
    hoạt động ổn định hơn với mic quá nhỏ hoặc quá to, thay vì để nguyên
    biên độ gốc vốn rất khác nhau giữa các thiết bị."""
    peak = np.max(np.abs(mono)) if mono.size else 0.0
    if peak < 1e-6:
        return mono
    gain = min(target_peak / peak, 10.0)  # giới hạn gain để không khuếch đại nhiễu nền quá mức
    return (mono * gain).astype(np.float32)


def transcribe_chunk(model, mono, rms):
    """Transcribe một chunk mono độc lập. Trả về text rỗng nếu quá im lặng
    (tránh Whisper 'nghe ra chữ' từ nhiễu nền/im lặng - hallucination)."""
    if rms < SILENCE_RMS_THRESHOLD:
        return ""
    mono = normalize_peak(mono)
    segments, _ = model.transcribe(
        mono,
        beam_size=5,               # khôi phục beam_size=5 để tăng độ chính xác giải mã
        language="vi",
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=300),
        condition_on_previous_text=False,  # để False vì mỗi chunk độc lập; bật lên dễ gây lặp câu (hallucination loop) khi nối các chunk rời rạc
        no_speech_threshold=0.6,
    )
    return "".join(seg.text for seg in segments).strip()


def main():
    global recording
    print("Loading AI Model...", flush=True)
    import os
    cpu_cores = os.cpu_count() or 4
    try:
        # Tối ưu hóa đa luồng (cpu_threads) để tận dụng hết sức mạnh CPU
        model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8", cpu_threads=cpu_cores)
    except Exception as e:
        print(f"Model load error: {e}", file=sys.stderr)
        sys.exit(1)
    print("READY", flush=True)

    sample_rate = 16000
    try:
        speaker = sc.default_speaker()
        loopback_mic = sc.get_microphone(speaker.id, include_loopback=True)
    except Exception as e:
        print(f"Loopback error: {e}", file=sys.stderr)
        loopback_mic = None

    try:
        default_mic = sc.default_microphone()
    except Exception as e:
        print(f"Mic error: {e}", file=sys.stderr)
        default_mic = None

    if loopback_mic is None and default_mic is None:
        print("No audio devices found.", file=sys.stderr)
        sys.exit(1)

    q_loopback = queue.Queue(maxsize=MAX_QUEUE_CHUNKS)
    q_mic = queue.Queue(maxsize=MAX_QUEUE_CHUNKS)

    threads = []
    if loopback_mic:
        t1 = threading.Thread(target=record_stream, args=(loopback_mic, q_loopback, sample_rate))
        t1.daemon = True
        threads.append(t1)
        t1.start()

    if default_mic:
        t2 = threading.Thread(target=record_stream, args=(default_mic, q_mic, sample_rate))
        t2.daemon = True
        threads.append(t2)
        t2.start()

    def listen_stdin():
        global recording
        while True:
            line = sys.stdin.readline()
            if not line or line.strip() == "stop":
                recording = False
                break
            time.sleep(0.1)

    threading.Thread(target=listen_stdin, daemon=True).start()

    while recording:
        loopback_chunks = drain_all(q_loopback)
        mic_chunks = drain_all(q_mic)

        if not loopback_chunks and not mic_chunks:
            time.sleep(0.1)
            continue

        # QUAN TRỌNG: không còn cộng trung bình (mic + loopback) / 2 rồi đoán người nói
        # bằng RMS. Cách cũ có 2 vấn đề lớn:
        #   1) Khi cả 2 bên nói cùng lúc, tín hiệu cộng chồng lên nhau khiến Whisper
        #      nghe ra một câu lẫn lộn/không chính xác, thay vì tách rời 2 câu.
        #   2) Nhãn người nói chỉ dựa trên độ to (RMS) nên rất dễ gán sai (vd. bạn nói khẽ
        #      hơn loa ngoài vẫn có thể bị gán nhầm là "[Đối tác]").
        # Thay vào đó: transcribe RIÊNG mic và loopback, mỗi bên tự có nhãn cố định,
        # chính xác hơn nhiều dù tốn gấp đôi thời gian suy luận mỗi vòng lặp.
        if mic_chunks:
            mic_audio = np.concatenate(mic_chunks, axis=0)
            mic_mono = to_mono(mic_audio)
            mic_rms = float(np.sqrt(np.mean(mic_mono ** 2))) if mic_mono.size else 0.0
            try:
                text = transcribe_chunk(model, mic_mono, mic_rms)
            except Exception as e:
                print(f"Transcribe error (mic): {e}", file=sys.stderr)
                text = ""
            if text:
                print(f"[TRANSCRIPT] [Bạn] {text}", flush=True)

        if loopback_chunks:
            loopback_audio = np.concatenate(loopback_chunks, axis=0)
            loopback_mono = to_mono(loopback_audio)
            loopback_rms = float(np.sqrt(np.mean(loopback_mono ** 2))) if loopback_mono.size else 0.0
            try:
                text = transcribe_chunk(model, loopback_mono, loopback_rms)
            except Exception as e:
                print(f"Transcribe error (loopback): {e}", file=sys.stderr)
                text = ""
            if text:
                print(f"[TRANSCRIPT] [Đối tác] {text}", flush=True)

    print("STOPPED", flush=True)


if __name__ == "__main__":
    main()
