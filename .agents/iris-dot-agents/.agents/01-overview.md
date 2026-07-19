# 01 — Tổng quan dự án

## I.R.I.S là gì?

Một ứng dụng desktop (Electron + React) đóng vai trò "trợ lý giọng nói kiểu JARVIS".
Kiến trúc "hai bộ não":

- **Gemini Live** (`@google/genai`, model `models/gemini-3.1-flash-live-preview`) —
  xử lý hội thoại thời gian thực: nghe giọng nói, trả lời bằng giọng nói, hỗ trợ
  ngắt lời (barge-in), có Google Search tích hợp cho câu hỏi nhanh.
- **Hermes Agent** — một agent ngoài (dự án riêng của NousResearch, không nằm
  trong repo này) chạy như một "gateway" HTTP cục bộ (`http://127.0.0.1:8642`
  mặc định). Đây là nơi thực hiện việc nặng: research, code, file, terminal,
  browser automation, email, Notion... I.R.I.S chỉ là lớp giao tiếp/điều phối,
  **không tự thực thi các tác vụ đó**.

Ngoài ra còn có:
- **MediaPipe hand tracking** (`@mediapipe/tasks-vision`) — điều khiển UI bằng cử
  chỉ tay, chạy hoàn toàn on-device (WASM/GPU).
- **Glass HUD mode** — cửa sổ Electron trong suốt, click-through, luôn nổi trên
  cùng (`always-on-top`), bật bằng phím tắt toàn cục (mặc định `Alt+Space`).
- **Wake word "Hey Iris"** — nhận diện on-device bằng ONNX (`onnxruntime-web`),
  kiểu openWakeWord (mel-spectrogram → embedding → classifier).

## Hai đường dẫn Gemini Live (điểm đáng chú ý)

Repo có **hai** cách kết nối tới Gemini Live song song:

1. **Trong tiến trình Electron chính** (`electron/main.mjs`) — dùng SDK JS
   `@google/genai` trực tiếp trong Node, đây là đường chính mà app thực sự dùng
   khi chạy `npm run dev` / `npm start`.
2. **Sidecar Python** (`sidecar/voice_server.py` + `hermes_client.py` +
   `hermes_process.py` + `protocol.py`) — dùng SDK Python `google-genai` +
   `pyaudio`, giao tiếp qua stdout/stdin theo giao thức JSON dòng-lệnh
   (`protocol.py`). Có script riêng `npm run sidecar`.

→ Xem chi tiết lý do và khác biệt trong `03-sidecar-python.md`.

## Thành phần thư mục

```
electron/     Tiến trình chính (main process): phiên Gemini Live, cầu nối Hermes,
              cổng xác nhận dispatch, điều khiển cửa sổ Glass HUD, tray, cấu hình
src/
  components/ TopBar, CommsPanel, WorkStream, WorkCard, CenterStage, HudShell,
              ReaderOverlay, SessionSwitcher, SetupPanel, ReactorCore (orb), ...
  hooks/      useAudioPipeline, useHandControl, useWakeWord, useHandoffFx
  lib/        audio/PCM helper, tiện ích task + fuzzy matching, dữ liệu demo
  styles/     Hệ thống thiết kế "deep-space" (tokens → base → deck → overlays → fx → hud)
public/wakeword/  Mô hình ONNX "Hey Iris" chạy on-device
sidecar/      Sidecar Python thay thế/độc lập cho phiên Gemini Live + quản lý
              tiến trình Hermes gateway
build/        Icon app (nguồn SVG + script render) và tài nguyên tray
scripts/      Script dev (chạy Electron), script render icon, script gọi Python
```

## Nguyên tắc thiết kế cốt lõi (rút ra từ code, không phải suy đoán)

1. **Cổng xác nhận 2 bước trước khi giao việc cho Hermes**: Gemini chỉ có thể gọi
   `propose_hermes_task` (soạn brief) rồi phải chờ người dùng nói "đồng ý" ở
   **lượt nói riêng của họ**; chỉ khi đó `submit_hermes_task` mới được phép chạy.
   Cơ chế này được enforce **bằng state trong code** (`electron/main.mjs`), không
   chỉ dựa vào prompt — xem `02-electron-main.md`.
2. **Không bịa kết quả Hermes**: trạng thái/kết quả chỉ được lấy từ API thật của
   Hermes; nếu chưa có, câu trả lời hợp lệ duy nhất là "vẫn đang chạy".
3. **Một phiên Hermes được ghim (pinned session)** cho mỗi cuộc trò chuyện Iris,
   tương tự việc chọn 1 thread chat — tránh tạo phiên rác.
4. **Tất cả xử lý camera/gesture và wake-word đều on-device** — không có khung
   hình camera hay audio khi "ngủ" nào được gửi lên mạng.
