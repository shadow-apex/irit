"""
Test luồng async của run_cloud() bằng một Deepgram client GIẢ (không gọi
mạng thật — môi trường viết code này không có quyền truy cập api.deepgram.com).

Mục tiêu: xác nhận cấu trúc concurrency (task start_listening() chạy song
song với vòng lặp gửi audio) hoạt động đúng logic, và cơ chế
reconnect-with-backoff -> rớt về dự phòng sau N lần lỗi liên tiếp chạy đúng
như thiết kế. Đây KHÔNG thay thế cho việc test thật với Deepgram/mic thật.
"""
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
import deepgram as deepgram_pkg  # noqa: E402
from deepgram.core.events import EventType  # noqa: E402


class FakeConnection:
    def __init__(self, fail=False):
        self._handlers = {}
        self._fail = fail
        self.sent_media = []
        self.closed = False

    def on(self, event_type, handler):
        self._handlers[event_type] = handler

    async def start_listening(self):
        if self._fail:
            raise ConnectionError("giả lập lỗi mạng")
        # Giả lập server gửi 2 mẩu is_final rồi 1 speech_final, sau đó "treo"
        # (giữ socket mở) y như một kết nối thật đang chờ audio tiếp theo.
        await asyncio.sleep(0.01)
        msg1 = lt.__dict__  # placeholder, sẽ build message thật bên dưới
        from deepgram.listen.v1.types.listen_v1results import ListenV1Results
        from deepgram.listen.v1.types.listen_v1results_channel import ListenV1ResultsChannel
        from deepgram.listen.v1.types.listen_v1results_channel_alternatives_item import (
            ListenV1ResultsChannelAlternativesItem,
        )
        from deepgram.listen.v1.types.listen_v1results_metadata import ListenV1ResultsMetadata

        def build(transcript, is_final, speech_final):
            alt = ListenV1ResultsChannelAlternativesItem(transcript=transcript, confidence=0.9, words=[])
            channel = ListenV1ResultsChannel(alternatives=[alt])
            metadata = ListenV1ResultsMetadata.model_construct()
            return ListenV1Results(
                channel_index=[0], duration=1.0, start=0.0,
                is_final=is_final, speech_final=speech_final,
                channel=channel, metadata=metadata,
            )

        handler = self._handlers.get(EventType.MESSAGE)
        if handler:
            handler(build("Xin chào", True, False))
            handler(build("thế giới", True, True))
        # Giữ "kết nối" mở vô thời hạn cho tới khi bị cancel (giống thật)
        await asyncio.Event().wait()

    async def send_media(self, data):
        self.sent_media.append(len(data))

    async def send_close_stream(self):
        self.closed = True


class FakeConnectCtx:
    def __init__(self, fail=False):
        self.fail = fail

    async def __aenter__(self):
        if self.fail:
            raise ConnectionError("giả lập không nối được")
        self._conn = FakeConnection(fail=False)
        return self._conn

    async def __aexit__(self, *exc):
        return False


class FakeListenV1:
    def __init__(self, fail=False):
        self.fail = fail

    def connect(self, **kwargs):
        return FakeConnectCtx(fail=self.fail)


class FakeListen:
    def __init__(self, fail=False):
        self.v1 = FakeListenV1(fail=fail)


class FakeAsyncDeepgramClient:
    """Thay cho deepgram.AsyncDeepgramClient thật."""
    fail_mode = False  # class-level switch để test điều khiển từ ngoài

    def __init__(self, api_key=None):
        self.listen = FakeListen(fail=FakeAsyncDeepgramClient.fail_mode)


async def test_run_cloud_happy_path_emits_transcript():
    deepgram_pkg.AsyncDeepgramClient = FakeAsyncDeepgramClient
    FakeAsyncDeepgramClient.fail_mode = False

    lt.DEEPGRAM_API_KEY = "fake-key-for-test"
    ch = lt.AudioChannel("Bạn", device=None)
    ch.mode = "cloud"
    emitted = []
    ch.emit = lambda text: emitted.append(text)
    # Đẩy sẵn vài khối audio giả vào queue để vòng gửi có gì để gửi
    for _ in range(3):
        ch.raw_queue.put_nowait(np.zeros((lt.FRAME_SAMPLES,), dtype=np.float32))

    task = asyncio.create_task(ch.run_cloud())
    await asyncio.sleep(0.1)  # đủ thời gian để FakeConnection bắn 2 message
    ch.stop()
    await asyncio.wait_for(task, timeout=2.0)

    assert emitted == ["Xin chào thế giới"], emitted
    print("test_run_cloud_happy_path_emits_transcript: OK")


async def test_run_cloud_falls_back_after_max_reconnects():
    deepgram_pkg.AsyncDeepgramClient = FakeAsyncDeepgramClient
    FakeAsyncDeepgramClient.fail_mode = True  # mọi lần connect() đều raise

    lt.DEEPGRAM_API_KEY = "fake-key-for-test"
    lt.MAX_RECONNECT_ATTEMPTS = 3  # rút ngắn cho test chạy nhanh

    ch = lt.AudioChannel("Đối tác", device=None)
    ch.mode = "cloud"

    fallback_called = {"count": 0}

    async def fake_fallback():
        fallback_called["count"] += 1

    ch.run_fallback = fake_fallback

    # Backoff dùng min(2**attempts, 10) giây -> với 3 lần thử sẽ mất vài giây
    # thật. Ta patch asyncio.sleep chỉ trong scope hàm này để test chạy tức thì,
    # nhưng vẫn giữ nguyên logic đếm số lần thử.
    real_sleep = asyncio.sleep

    async def fast_sleep(seconds):
        await real_sleep(0)  # nhường event loop, không chờ thật

    orig_sleep = asyncio.sleep
    asyncio.sleep = fast_sleep
    try:
        await asyncio.wait_for(ch.run_cloud(), timeout=5.0)
    finally:
        asyncio.sleep = orig_sleep

    assert fallback_called["count"] == 1, fallback_called
    assert ch.mode == "fallback"
    print("test_run_cloud_falls_back_after_max_reconnects: OK")


async def main():
    await test_run_cloud_happy_path_emits_transcript()
    await test_run_cloud_falls_back_after_max_reconnects()


if __name__ == "__main__":
    asyncio.run(main())
    print("ALL ASYNC TESTS PASSED")


class FakeConnectionInstantReject(FakeConnection):
    """Giả lập kiểu lỗi tinh vi: socket MỞ được (aenter không raise), nhưng
    server từ chối gần như ngay lập tức qua on_error (vd. API key sai) —
    đây chính là ca mà bản sửa lỗi HEALTHY_CONNECTION_SECONDS nhắm tới."""

    def __init__(self):
        super().__init__(fail=False)

    async def start_listening(self):
        await asyncio.sleep(0.001)
        handler = self._handlers.get(EventType.ERROR)
        if handler:
            handler(ConnectionError("giả lập: key sai, server từ chối ngay"))
        await asyncio.Event().wait()  # giữ task "chạy" cho tới khi bị cancel


class FakeConnectCtxInstantReject:
    async def __aenter__(self):
        return FakeConnectionInstantReject()

    async def __aexit__(self, *exc):
        return False


class FakeListenV1InstantReject:
    def connect(self, **kwargs):
        return FakeConnectCtxInstantReject()


class FakeListenInstantReject:
    def __init__(self):
        self.v1 = FakeListenV1InstantReject()


class FakeAsyncDeepgramClientInstantReject:
    def __init__(self, api_key=None):
        self.listen = FakeListenInstantReject()


async def test_run_cloud_falls_back_when_connection_opens_but_instantly_rejects():
    """Trước bản sửa lỗi: attempts bị reset về 0 ngay khi socket mở, nên vòng
    lặp mở-rồi-bị-từ-chối-ngay này sẽ LẶP VÔ HẠN, không bao giờ rớt về dự
    phòng. Test này xác nhận bug đã được sửa."""
    deepgram_pkg.AsyncDeepgramClient = FakeAsyncDeepgramClientInstantReject

    lt.DEEPGRAM_API_KEY = "fake-key-for-test"
    lt.MAX_RECONNECT_ATTEMPTS = 3

    ch = lt.AudioChannel("Bạn", device=None)
    ch.mode = "cloud"

    fallback_called = {"count": 0}

    async def fake_fallback():
        fallback_called["count"] += 1

    ch.run_fallback = fake_fallback

    orig_sleep = asyncio.sleep

    async def fast_sleep(seconds):
        await orig_sleep(0)

    asyncio.sleep = fast_sleep
    try:
        await asyncio.wait_for(ch.run_cloud(), timeout=5.0)
    finally:
        asyncio.sleep = orig_sleep

    assert fallback_called["count"] == 1, (
        "Phải rớt về dự phòng sau đúng MAX_RECONNECT_ATTEMPTS lần bị từ chối "
        f"ngay lập tức, không được lặp vô hạn. fallback_called={fallback_called}"
    )
    assert ch.mode == "fallback"
    print("test_run_cloud_falls_back_when_connection_opens_but_instantly_rejects: OK")


async def main2():
    await test_run_cloud_falls_back_when_connection_opens_but_instantly_rejects()


if __name__ == "__main__":
    asyncio.run(main2())
