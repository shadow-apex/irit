"""Test nhanh phần dự phòng (run_fallback): gom đủ 4s, bỏ qua im lặng, gọi
model.transcribe() với mono audio đúng, in ra qua emit()."""
import asyncio
import os
import sys
import types

# sidecar/tests/xxx.py -> thư mục sidecar/ chính là thư mục cha (..) ở đây
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

fake_soundcard = types.ModuleType("soundcard")
fake_soundcard.default_speaker = lambda: None
fake_soundcard.default_microphone = lambda: None
fake_soundcard.get_microphone = lambda *a, **k: None
sys.modules.setdefault("soundcard", fake_soundcard)

import numpy as np
import live_transcriber as lt  # noqa: E402


class FakeSegment:
    def __init__(self, text):
        self.text = text


class FakeModel:
    def __init__(self):
        self.calls = 0

    def transcribe(self, mono, **kwargs):
        self.calls += 1
        assert mono.ndim == 1, "phải là mono trước khi đưa vào Whisper"
        return [FakeSegment("xin chào ")], None


async def test_fallback_skips_silence_and_transcribes_loud_chunk():
    ch = lt.AudioChannel("Bạn", device=None)
    fake_model = FakeModel()
    lt.get_fallback_model = lambda: fake_model

    emitted = []
    ch.emit = lambda text: emitted.append(text)

    needed = int(lt.SAMPLE_RATE * lt.FALLBACK_CHUNK_SECONDS)
    silent = np.zeros((needed, 1), dtype=np.float32)
    loud = (np.random.RandomState(0).uniform(-0.5, 0.5, size=(needed, 1))).astype(np.float32)

    for frame in [silent]:
        ch.raw_queue.put_nowait(frame)
    for frame in [loud]:
        ch.raw_queue.put_nowait(frame)
    ch.stop_event.set()  # để vòng while thoát ngay sau khi rút hết queue lần đầu... 

    # run_fallback() chạy vô hạn cho tới khi stop_event set VÀ queue rỗng; ta
    # cần chạy nó trong task rồi để nó tự nhặt 2 khối đã bơm sẵn rồi thoát.
    ch.stop_event.clear()
    task = asyncio.create_task(ch.run_fallback())
    await asyncio.sleep(0.3)
    ch.stop()
    await asyncio.wait_for(task, timeout=2.0)

    assert fake_model.calls == 1, f"chỉ khối loud mới được transcribe, khối silent phải bị bỏ qua (calls={fake_model.calls})"
    assert emitted == ["xin chào"], emitted
    print("test_fallback_skips_silence_and_transcribes_loud_chunk: OK")


if __name__ == "__main__":
    asyncio.run(test_fallback_skips_silence_and_transcribes_loud_chunk())
    print("ALL FALLBACK TESTS PASSED")
