import sys
import json
import signal
import threading
import wave
from collections import deque
import warnings
warnings.filterwarnings("ignore")
import soundcard as sc
import numpy as np
import time
try:
    warnings.filterwarnings("ignore", category=sc.SoundcardRuntimeWarning)
    warnings.simplefilter("ignore")
except Exception:
    pass

recording = True
write_lock = threading.Lock()
speaker_segments = []  # Lưu mốc thời gian phân biệt Người nói 1 (Mic) và Người nói 2 (Hệ thống)

# Giới hạn tối đa ~45 giây âm thanh trong hàng đợi (~700 chunks ở 16kHz/1024 frames)
# để chống tràn RAM nếu I/O đĩa bị nghẽn tạm thời và dùng popleft() O(1).
MAX_BUFFER_CHUNKS = 700
# Nếu 1 nguồn (loopback/mic) bị trễ hơn nguồn kia quá ~0.6s (10 chunks),
# xả bớt phần trễ để không bị lệch tiếng giữa người nói và loa hệ thống.
MAX_DRIFT_CHUNKS = 10


def _handle_stop_signal(_signum, _frame):
    global recording
    recording = False


signal.signal(signal.SIGINT, _handle_stop_signal)
signal.signal(signal.SIGTERM, _handle_stop_signal)


def clamp_to_int16(mixed_float):
    """mixed_float là mảng float32 -> nén mềm (soft-clip) trong [-1, 1] -> int16 PCM."""
    clipped = np.clip(mixed_float, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16)


def record_stream(mic, sample_rate, chunk_frames, out_buf, name):
    """Đọc audio theo chunk và đẩy vào deque giới hạn kích thước, KHÔNG tích luỹ
    toàn bộ cuộc họp trong RAM."""
    try:
        with mic.recorder(samplerate=sample_rate, blocksize=chunk_frames) as recorder:
            while recording:
                data = recorder.record(numframes=chunk_frames)
                if not recording:
                    break
                out_buf.append(data)
    except Exception as e:
        print(f"Error recording from {name}: {e}", file=sys.stderr, flush=True)


def to_mono(arr):
    if arr is None:
        return None
    arr = np.asarray(arr, dtype=np.float32)
    if arr.ndim > 1:
        return np.mean(arr, axis=1).astype(np.float32)
    return arr


def mixer_writer(wav_writer, loopback_buf, mic_buf, sample_rate=16000):
    """Chạy trên thread riêng: định kỳ lấy chunk mới nhất từ 2 buffer,
    tách kênh Stereo phục vụ Speaker Diarization (Kênh Trái = Người nói 1 / Mic,
    Kênh Phải = Người nói 2 / Loa hệ thống kèm 20% crossfeed tự nhiên),
    ghi thẳng ra file .wav và theo dõi timeline người nói."""
    total_frames_written = 0
    active_speaker = None
    segment_start_sec = 0.0

    while recording or loopback_buf or mic_buf:
        # Chống lệch pha (drift) khi WASAPI loopback nhả bù các frame sau khoảng lặng
        while len(loopback_buf) > MAX_DRIFT_CHUNKS and len(mic_buf) == 0 and recording:
            loopback_buf.popleft()
        while len(mic_buf) > MAX_DRIFT_CHUNKS and len(loopback_buf) == 0 and recording:
            break

        lb_mono = to_mono(loopback_buf.popleft() if loopback_buf else None)
        mb_mono = to_mono(mic_buf.popleft() if mic_buf else None)

        if lb_mono is None and mb_mono is None:
            if not recording:
                break
            time.sleep(0.02)
            continue

        if lb_mono is None:
            lb_mono = np.zeros_like(mb_mono)
        if mb_mono is None:
            mb_mono = np.zeros_like(lb_mono)

        min_len = min(len(lb_mono), len(mb_mono))
        if min_len == 0:
            continue

        lb_slice = lb_mono[:min_len]
        mb_slice = mb_mono[:min_len]

        # Tính năng lượng RMS để nhận diện ai đang nói (Speaker Diarization)
        mic_rms = float(np.sqrt(np.mean(mb_slice ** 2)))
        lb_rms = float(np.sqrt(np.mean(lb_slice ** 2)))
        now_sec = round(total_frames_written / float(sample_rate), 2)

        current_spk = None
        if mic_rms > 0.008 and mic_rms >= lb_rms * 0.8:
            current_spk = "Người nói 1 (Bạn)"
        elif lb_rms > 0.008:
            current_spk = "Người nói 2 (Đối tác)"

        if current_spk and current_spk != active_speaker:
            if active_speaker is not None and (now_sec - segment_start_sec) >= 0.4:
                speaker_segments.append({
                    "start_sec": segment_start_sec,
                    "end_sec": now_sec,
                    "speaker": active_speaker,
                })
            active_speaker = current_spk
            segment_start_sec = now_sec

        # Stereo Diarization Mix: Kênh Trái ưu tiên Mic (Người nói 1), Kênh Phải ưu tiên Loopback (Người nói 2)
        left_ch = mb_slice + 0.25 * lb_slice
        right_ch = lb_slice + 0.25 * mb_slice
        stereo_raw = np.column_stack([left_ch, right_ch])
        mixed = np.where(np.abs(stereo_raw) > 0.95, np.tanh(stereo_raw), stereo_raw)
        pcm = clamp_to_int16(mixed)

        with write_lock:
            wav_writer.writeframes(pcm.tobytes())
        total_frames_written += min_len

    end_sec = round(total_frames_written / float(sample_rate), 2)
    if active_speaker is not None and (end_sec - segment_start_sec) >= 0.4:
        speaker_segments.append({
            "start_sec": segment_start_sec,
            "end_sec": end_sec,
            "speaker": active_speaker,
        })


def main():
    global recording
    if len(sys.argv) < 2:
        print("Thiếu đường dẫn file output.", file=sys.stderr, flush=True)
        sys.exit(1)

    output_file = sys.argv[1]
    sample_rate = 16000
    channels = 2
    chunk_frames = 1024

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

    loopback_buf = deque(maxlen=MAX_BUFFER_CHUNKS)
    mic_buf = deque(maxlen=MAX_BUFFER_CHUNKS)

    wav_writer = wave.open(output_file, "wb")
    try:
        wav_writer.setnchannels(channels)
        wav_writer.setsampwidth(2)  # int16 = 2 bytes
        wav_writer.setframerate(sample_rate)

        threads = []
        if loopback_mic:
            t1 = threading.Thread(
                target=record_stream,
                args=(loopback_mic, sample_rate, chunk_frames, loopback_buf, "loopback"),
                daemon=True,
            )
            threads.append(t1)
            t1.start()

        if default_mic:
            t2 = threading.Thread(
                target=record_stream,
                args=(default_mic, sample_rate, chunk_frames, mic_buf, "microphone"),
                daemon=True,
            )
            threads.append(t2)
            t2.start()

        writer_thread = threading.Thread(target=mixer_writer, args=(wav_writer, loopback_buf, mic_buf, sample_rate))
        writer_thread.start()

        print("READY", flush=True)

        try:
            while recording:
                line = sys.stdin.readline()
                if not line or line.strip() == "stop":
                    break
        except (KeyboardInterrupt, EOFError):
            pass

        print("STOPPING", flush=True)
        recording = False

        # Capture threads là daemon: nếu WASAPI loopback đang block vì loa im lặng,
        # không để nó giữ tiến trình quá 1.0s làm trễ việc đóng header WAV.
        for t in threads:
            t.join(timeout=1.0)
        writer_thread.join(timeout=3.0)
    finally:
        with write_lock:
            try:
                wav_writer.close()
            except Exception as close_err:
                print(f"Error closing WAV: {close_err}", file=sys.stderr, flush=True)

    try:
        diar_path = output_file[:-4] + "_diarization.json" if output_file.lower().endswith(".wav") else output_file + "_diarization.json"
        with open(diar_path, "w", encoding="utf-8") as df:
            json.dump({"segments": speaker_segments[:500]}, df, ensure_ascii=False, indent=2)
    except Exception:
        pass

    print(f"SAVED:{output_file}", flush=True)


if __name__ == "__main__":
    main()

