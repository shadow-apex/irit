import sys
import threading
import wave
import soundcard as sc
import numpy as np
import time

recording = True
write_lock = threading.Lock()


def clamp_to_int16(mixed_float):
    """mixed_float là mảng float32 trong khoảng [-1, 1] (xấp xỉ) -> int16 PCM."""
    clipped = np.clip(mixed_float, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16)


def record_stream(mic, sample_rate, chunk_frames, out_buf, name):
    """Đọc audio theo chunk và đẩy vào buffer chờ ghép, KHÔNG tích luỹ
    toàn bộ cuộc họp trong RAM (khác bản cũ dùng frames_list.append vô hạn)."""
    try:
        with mic.recorder(samplerate=sample_rate) as recorder:
            while recording:
                data = recorder.record(numframes=chunk_frames)
                out_buf.append(data)
    except Exception as e:
        print(f"Error recording from {name}: {e}", file=sys.stderr)


def mixer_writer(wav_writer, loopback_buf, mic_buf):
    """Chạy trên thread riêng: định kỳ lấy chunk mới nhất từ 2 buffer,
    trộn lại, và GHI THẲNG ra file .wav ngay lập tức rồi giải phóng khỏi
    RAM. Đây là điểm khác biệt chính so với bản cũ (giữ toàn bộ audio
    trong list rồi mới concat vào cuối -> tràn RAM với cuộc họp dài)."""
    while recording or loopback_buf or mic_buf:
        lb = loopback_buf.pop(0) if loopback_buf else None
        mb = mic_buf.pop(0) if mic_buf else None

        if lb is None and mb is None:
            if not recording:
                break
            time.sleep(0.05)
            continue

        if lb is None:
            lb = np.zeros_like(mb)
        if mb is None:
            mb = np.zeros_like(lb)

        min_len = min(len(lb), len(mb))
        if min_len == 0:
            continue

        mixed = (lb[:min_len] + mb[:min_len]) / 2.0
        pcm = clamp_to_int16(mixed)

        with write_lock:
            wav_writer.writeframes(pcm.tobytes())


def main():
    global recording
    if len(sys.argv) < 2:
        print("Thiếu đường dẫn file output.", file=sys.stderr)
        sys.exit(1)

    output_file = sys.argv[1]
    sample_rate = 16000
    channels = 2
    chunk_frames = 1024

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

    loopback_buf = []
    mic_buf = []

    wav_writer = wave.open(output_file, "wb")
    wav_writer.setnchannels(channels)
    wav_writer.setsampwidth(2)  # int16 = 2 bytes
    wav_writer.setframerate(sample_rate)

    threads = []
    if loopback_mic:
        t1 = threading.Thread(target=record_stream, args=(loopback_mic, sample_rate, chunk_frames, loopback_buf, "loopback"))
        threads.append(t1)
        t1.start()

    if default_mic:
        t2 = threading.Thread(target=record_stream, args=(default_mic, sample_rate, chunk_frames, mic_buf, "microphone"))
        threads.append(t2)
        t2.start()

    writer_thread = threading.Thread(target=mixer_writer, args=(wav_writer, loopback_buf, mic_buf))
    writer_thread.start()

    print("READY", flush=True)

    try:
        while True:
            line = sys.stdin.readline()
            if not line or line.strip() == "stop":
                break
            time.sleep(0.1)
    except KeyboardInterrupt:
        pass

    print("STOPPING", flush=True)
    recording = False

    for t in threads:
        t.join(timeout=2.0)
    writer_thread.join(timeout=5.0)

    wav_writer.close()

    print(f"SAVED:{output_file}", flush=True)


if __name__ == "__main__":
    main()
