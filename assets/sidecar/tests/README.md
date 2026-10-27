# Test cho sidecar/live_transcriber.py

3 file test ở đây chỉ kiểm tra được phần LOGIC THUẦN (chuyển đổi audio, gom
transcript, cơ chế reconnect/fallback) bằng mock — **không** gọi mic/loa/
Deepgram thật, vì môi trường viết code không có thiết bị âm thanh và không
gọi mạng ra ngoài được tới Deepgram. Đây không thay thế cho việc bạn tự chạy
thử Alt+T thật (xem báo cáo đi kèm bản zip).

Chạy từng file trực tiếp (không cần cài pytest):

```bash
cd sidecar
python3 tests/test_live_transcriber_logic.py
python3 tests/test_live_transcriber_async_flow.py
python3 tests/test_fallback_logic.py
```

Hoặc chạy hết bằng pytest nếu đã có sẵn: `pytest sidecar/tests/ -v`

- `test_live_transcriber_logic.py` — chuyển đổi audio (mono/PCM16), và logic
  gom is_final -> chốt câu đúng lúc (speech_final / UtteranceEnd), dùng
  chính pydantic model thật của gói `deepgram-sdk` để dựng message giả.
- `test_live_transcriber_async_flow.py` — luồng async đầy đủ của
  `run_cloud()` với một Deepgram client giả: đường "chạy tốt" (audio vào ->
  transcript ra), đường "lỗi liên tục" -> rớt về dự phòng, và một test hồi
  quy riêng cho lỗi đã sửa: kết nối MỞ được nhưng bị từ chối gần như ngay
  lập tức (vd. sai API key) — nếu không có `HEALTHY_CONNECTION_SECONDS`,
  trường hợp này sẽ lặp vô hạn mà không bao giờ rớt về dự phòng.
- `test_fallback_logic.py` — chế độ dự phòng (Whisper cục bộ) vẫn bỏ qua
  đúng khối im lặng và chỉ transcribe khối có tiếng.
