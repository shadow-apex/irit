# 03 — Sidecar Python (`sidecar/`)

## Vai trò

Đây là một **triển khai song song, độc lập** của phần "phiên Gemini Live +
dispatch Hermes", viết bằng Python, KHÔNG phải là thứ Electron gọi ra khi chạy
bình thường (`npm run dev`). Được chạy riêng qua `npm run sidecar`
(→ `scripts/python-command.mjs sidecar`) hoặc `npm run check:python`.

Cấu trúc:
- `protocol.py` — giao thức JSON theo dòng (newline-delimited JSON) để giao
  tiếp với tiến trình cha (Electron) qua stdout/stdin: `emit()`, `emit_log()`,
  `read_commands()` (đọc lệnh không chặn/poll).
- `hermes_client.py` — client HTTP thuần (`urllib`, không phụ thuộc thư viện
  ngoài) gọi các endpoint Hermes: `health`, `capabilities`, `start_run`,
  `get_run`, `stop_run`, `approve_run`. Gửi `Authorization: Bearer <API_SERVER_KEY>`.
- `hermes_process.py` — `HermesProcessManager`: **tự khởi động tiến trình
  `hermes gateway`** nếu chưa chạy, dò tìm binary `hermes` ở các thư mục PATH
  phổ biến bị thiếu khi app GUI khởi chạy từ Finder/Cursor
  (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, ...), ghi log ra file
  thay vì PIPE (tránh treo khi buffer đầy), và có cơ chế `stop_if_owned()` để
  chỉ dừng tiến trình do chính nó khởi động.
- `voice_server.py` (~651 dòng) — vòng lặp audio chính dùng `pyaudio` +
  SDK Python `google-genai`, gửi PCM 16kHz / nhận PCM 24kHz, có
  `context_window_compression` và `session_resumption` (khôi phục phiên khi
  WebSocket bị reset định kỳ) — hai tính năng **không thấy xuất hiện rõ trong
  `electron/main.mjs`**, có thể là điểm sidecar "tiến bộ hơn" ở khía cạnh độ ổn
  định phiên dài.

## Khác biệt quan trọng so với đường dẫn Electron chính

1. **Không có cổng xác nhận 2 bước (`hermesGate.mjs`)**. System instruction của
   sidecar nói thẳng: *"When the user asks for almost anything actionable ...
   immediately call submit_hermes_task"* — gọi thẳng `submit_hermes_task`, không
   qua bước `propose_hermes_task` + chờ người dùng xác nhận ở lượt nói riêng.
   → Đây là khác biệt hành vi lớn nhất giữa hai đường dẫn. Nếu ai đó bật sidecar
   thay vì đường Electron chính, họ sẽ **mất** cơ chế an toàn "system-enforced
   confirmation gate" mà README quảng cáo là tính năng cốt lõi.
2. Sidecar tự có khả năng khởi động tiến trình `hermes gateway` giúp người dùng
   (`HermesProcessManager.ensure_running`), trong khi đường Electron chính
   (`electron/main.mjs`) dường như giả định Hermes gateway đã chạy sẵn (theo
   hướng dẫn Quick Start bước 2 trong README: người dùng tự bật
   `API_SERVER_ENABLED` rồi `hermes gateway restart`).
3. Tool set của sidecar nhỏ hơn: chỉ có `check_hermes_status`, `start_hermes`,
   `submit_hermes_task`, `get_hermes_task_status`, `stop_hermes_task`,
   `approve_hermes_action` — **không có** bộ `buildIrisUiTools()` (điều khiển UI
   bằng giọng nói) mà `electron/main.mjs` có.

## Kết luận / giả thuyết

Nhiều khả năng đây là bản **prototype ban đầu** (Python, dễ thử nghiệm nhanh
với SDK Gemini) trước khi dự án được port sang toàn bộ Node/Electron cho bản
production. Repo vẫn giữ lại nó — có thể để tham khảo, debug độc lập phần audio
mà không cần build Electron, hoặc cho các nền tảng chưa hỗ trợ tốt qua Electron.
Người đóng góp mới **không nên giả định code trong `sidecar/` phản ánh đúng
hành vi hiện tại của app** — hãy lấy `electron/main.mjs` làm nguồn sự thật
(source of truth).
