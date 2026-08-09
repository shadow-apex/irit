import pyaudiowpatch as pyaudio
import wave

DURATION = 3.0

with pyaudio.PyAudio() as p:
    try:
        # Get default WASAPI info
        wasapi_info = p.get_host_api_info_by_type(pyaudio.paWASAPI)
    except OSError:
        print("Lỗi: Không tìm thấy WASAPI.")
        exit()

    # Get default loopback device
    default_speakers = p.get_device_info_by_index(wasapi_info["defaultOutputDevice"])
    
    if not default_speakers["isLoopbackDevice"]:
        for loopback in p.get_loopback_device_info_generator():
            if default_speakers["name"] in loopback["name"]:
                default_speakers = loopback
                break
        else:
            print("Lỗi: Không tìm thấy loopback device.")
            exit()
            
    print(f"Thu âm từ: {default_speakers['name']} (Sample rate: {int(default_speakers['defaultSampleRate'])})")
    
    frames = []
    
    def callback(in_data, frame_count, time_info, status):
        frames.append(in_data)
        return (in_data, pyaudio.paContinue)
        
    stream = p.open(format=pyaudio.paInt16,
                    channels=default_speakers["maxInputChannels"],
                    rate=int(default_speakers["defaultSampleRate"]),
                    input=True,
                    input_device_index=default_speakers["index"],
                    stream_callback=callback)
                    
    import time
    time.sleep(DURATION)
    
    stream.stop_stream()
    stream.close()

import numpy as np
if frames:
    data = np.frombuffer(b''.join(frames), dtype=np.int16)
    max_vol = np.max(np.abs(data))
    print(f"Âm lượng to nhất: {max_vol}")
    if max_vol == 0:
        print("LỖI: Âm thanh bị câm.")
    else:
        print("THÀNH CÔNG: Đã có âm thanh!")
else:
    print("LỖI: Không thu được frame nào.")
