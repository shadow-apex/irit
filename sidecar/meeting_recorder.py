import sys
import signal
import threading
import wave
from collections import deque
import soundcard as sc
import numpy as np
import time

recording = True
write_lock = threading.Lock()

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


def to_stereo(arr):
    if arr is None:
        return None
    arr = np.asarray(arr, dtype=np.float32)
    if arr.ndim == 1:
        return np.column_stack([arr, arr])
    if arr.ndim == 2:
        if arr.shape[1] == 1:
            return np.column_stack([arr[:, 0], arr[:, 0]])
        elif arr.shape[1] > 2:
            return arr[:, :2]
    return arr


def mixer_writer(wav_writer, loopback_buf, mic_buf):
    """Chạy trên thread riêng: định kỳ lấy chunk mới nhất từ 2 buffer,
    trộn lại, và GHI THẲNG ra file .wav ngay lập tức rồi giải phóng khỏi
    RAM. Đảm bảo chuẩn hoá stereo và chống lệch pha giữa mic và loa."""
    while recording or loopback_buf or mic_buf:
        # Chống lệch pha (drift) khi WASAPI loopback nhả bù các frame sau khoảng lặng
        while len(loopback_buf) > MAX_DRIFT_CHUNKS and len(mic_buf) == 0 and recording:
            loopback_buf.popleft()
        while len(mic_buf) > MAX_DRIFT_CHUNKS and len(loopback_buf) == 0 and recording:
            break

        lb = to_stereo(loopback_buf.popleft() if loopback_buf else None)
        mb = to_stereo(mic_buf.popleft() if mic_buf else None)

        if lb is None and mb is None:
            if not recording:
                break
            time.sleep(0.02)
            continue

        if lb is None:
            lb = np.zeros_like(mb)
        if mb is None:
            mb = np.zeros_like(lb)

        min_len = min(len(lb), len(mb))
        if min_len == 0:
            continue

        # Cộng trực tiếp thay vì chia đôi (/ 2.0) để không bị nhỏ tiếng (-6dB) khi chỉ 1 bên nói,
        # dùng np.tanh nhẹ khi biên độ vượt ngưỡng để chống rè (clipping) lúc cả 2 cùng nói.
        raw_sum = lb[:min_len] + mb[:min_len]
        mixed = np.where(np.abs(raw_sum) > 0.95, np.tanh(raw_sum), raw_sum)
        pcm = clamp_to_int16(mixed)

        with write_lock:
            wav_writer.writeframes(pcm.tobytes())


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

        writer_thread = threading.Thread(target=mixer_writer, args=(wav_writer, loopback_buf, mic_buf))
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

    print(f"SAVED:{output_file}", flush=True)


if __name__ == "__main__":
    main()

