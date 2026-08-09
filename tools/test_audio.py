import soundcard as sc
import soundfile as sf
import numpy as np

print("Các loa đang có:")
for speaker in sc.all_speakers():
    print(" -", speaker.name)

default_spk = sc.default_speaker()
print("Loa mặc định đang chọn:", default_spk.name)

mic = sc.get_microphone(id=str(default_spk.name), include_loopback=True)
print("Bắt đầu thu âm 3 giây...")
with mic.recorder(samplerate=48000) as recorder:
    data = recorder.record(numframes=48000 * 3)

max_vol = np.max(np.abs(data))
print("Âm lượng to nhất đo được:", max_vol)
if max_vol == 0:
    print("LỖI: Âm thanh thu được toàn là số 0 (câm hoàn toàn).")
else:
    print("THÀNH CÔNG: Có âm thanh được thu vào!")
