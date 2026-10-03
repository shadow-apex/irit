"""
Unit test cho phần logic THUẦN (không cần mic/loa/network thật):
  - to_mono_float / to_pcm16_bytes: chuyển đổi audio đúng.
  - AudioChannel._handle_message: gom is_final -> chốt câu đúng lúc
    (speech_final=True hoặc UtteranceEnd), không lặp, không thiếu.

Test này dùng CHÍNH các pydantic model thật của gói deepgram-sdk (đã cài
trong môi trường viết code) để dựng message giả lập, thay vì tự bịa dict —
để việc test bám sát cấu trúc field thật nhất có thể trong điều kiện không
gọi được ra Deepgram thật.
"""
import io
import sys
import os
import contextlib
import numpy as np

# sidecar/tests/xxx.py -> thư mục sidecar/ chính là thư mục cha (..) ở đây
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Môi trường viết code này không có audio server thật (không có pulseaudio),
# nên "import soundcard" thật sẽ throw ngay khi load module. Test này chỉ cần
# kiểm tra logic thuần (chuyển đổi audio, gom is_final -> chốt câu), không
# đụng tới phần cứng, nên chỉ cần giả một module "soundcard" rỗng đủ để
# `import soundcard as sc` trong live_transcriber.py không văng lỗi khi load.
import types

fake_soundcard = types.ModuleType("soundcard")
fake_soundcard.default_speaker = lambda: None
fake_soundcard.default_microphone = lambda: None
fake_soundcard.get_microphone = lambda *a, **k: None
sys.modules.setdefault("soundcard", fake_soundcard)

import live_transcriber as lt  # noqa: E402

from deepgram.listen.v1.types.listen_v1results import ListenV1Results
from deepgram.listen.v1.types.listen_v1results_channel import ListenV1ResultsChannel
from deepgram.listen.v1.types.listen_v1results_channel_alternatives_item import (
    ListenV1ResultsChannelAlternativesItem,
)
from deepgram.listen.v1.types.listen_v1results_metadata import ListenV1ResultsMetadata
from deepgram.listen.v1.types.listen_v1utterance_end import ListenV1UtteranceEnd


def make_results(transcript, is_final, speech_final):
    alt = ListenV1ResultsChannelAlternativesItem(transcript=transcript, confidence=0.95, words=[])
    channel = ListenV1ResultsChannel(alternatives=[alt])
    metadata = ListenV1ResultsMetadata.model_construct()
    return ListenV1Results(
        channel_index=[0],
        duration=1.0,
        start=0.0,
        is_final=is_final,
        speech_final=speech_final,
        channel=channel,
        metadata=metadata,
    )


def make_utterance_end():
    return ListenV1UtteranceEnd(channel=[0], last_word_end=1.0)


def test_audio_conversion():
    mono_stereo = np.array([[0.5, -0.5], [1.0, -1.0], [2.0, -2.0]], dtype=np.float32)  # 3rd row tests clipping
    mono = lt.to_mono_float(mono_stereo)
    assert mono.shape == (3,)
    assert abs(mono[0] - 0.0) < 1e-6  # (0.5 + -0.5)/2 == 0

    pcm = lt.to_pcm16_bytes(np.array([0.0, 1.0, -1.0, 2.0, -2.0], dtype=np.float32))
    assert len(pcm) == 5 * 2  # int16 = 2 bytes/sample
    values = np.frombuffer(pcm, dtype=np.int16)
    assert values[0] == 0
    assert values[1] == 32767  # clipped to +1.0 -> max int16 (approx, due to *32767)
    assert values[3] == 32767  # 2.0 clipped to 1.0 same as above
    print("test_audio_conversion: OK")


def test_handle_message_speech_final_flushes_once():
    ch = lt.AudioChannel("Bạn", device=None)
    emitted = []
    ch.emit = lambda text: emitted.append(text)

    # Câu nói liên tục "Xin chào các bạn" tới thành 2 mẩu is_final rồi speech_final
    ch._handle_message(make_results("Xin chào", is_final=False, speech_final=False))  # interim -> bỏ qua
    assert emitted == []
    ch._handle_message(make_results("Xin chào", is_final=True, speech_final=False))
    assert emitted == []  # chưa chốt câu, chỉ mới is_final từng mẩu
    ch._handle_message(make_results("các bạn", is_final=True, speech_final=True))
    assert emitted == ["Xin chào các bạn"], emitted
    # Sau khi chốt, câu tiếp theo phải bắt đầu lại từ đầu (không dính câu cũ)
    ch._handle_message(make_results("Câu tiếp theo", is_final=True, speech_final=True))
    assert emitted == ["Xin chào các bạn", "Câu tiếp theo"], emitted
    print("test_handle_message_speech_final_flushes_once: OK")


def test_handle_message_utterance_end_is_safety_net():
    ch = lt.AudioChannel("Đối tác", device=None)
    emitted = []
    ch.emit = lambda text: emitted.append(text)

    # speech_final không bắn (mạng chập chờn) nhưng UtteranceEnd tới -> vẫn phải chốt
    ch._handle_message(make_results("Anh khoẻ không", is_final=True, speech_final=False))
    assert emitted == []
    ch._handle_message(make_utterance_end())
    assert emitted == ["Anh khoẻ không"], emitted
    # UtteranceEnd lần 2 khi không có gì đang gom dở -> không emit rỗng
    ch._handle_message(make_utterance_end())
    assert emitted == ["Anh khoẻ không"], emitted
    print("test_handle_message_utterance_end_is_safety_net: OK")


def test_handle_message_ignores_empty_transcript():
    ch = lt.AudioChannel("Bạn", device=None)
    emitted = []
    ch.emit = lambda text: emitted.append(text)
    ch._handle_message(make_results("", is_final=True, speech_final=True))
    assert emitted == []
    print("test_handle_message_ignores_empty_transcript: OK")


if __name__ == "__main__":
    test_audio_conversion()
    test_handle_message_speech_final_flushes_once()
    test_handle_message_utterance_end_is_safety_net()
    test_handle_message_ignores_empty_transcript()
    print("ALL TESTS PASSED")
