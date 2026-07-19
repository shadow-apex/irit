# 06 — Cấu hình & bảo mật

## Thứ tự nạp cấu hình
`.env` trong repo (dev) → `~/.iris/.env` (`%USERPROFILE%\.iris\.env` trên
Windows, do wizard/app đóng gói ghi) → `.env` đóng gói kèm app
(`loadEnvFile()` trong `electron/main.mjs`).

## Biến môi trường chính (từ README, khớp với cách `main.mjs` đọc)

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `GEMINI_API_KEY` | (bắt buộc) | Lấy tại aistudio.google.com/apikey |
| `IRIS_USER_NAME` | — | Tên Iris dùng để xưng hô |
| `GEMINI_LIVE_MODEL` | `models/gemini-3.1-flash-live-preview` | Phải giữ tiền tố `models/`; model chat thường không mở được Live session |
| `GEMINI_LIVE_VOICE` | `Zephyr` | Chọn/nghe thử trong Settings |
| `HERMES_API_URL` | `http://127.0.0.1:8642` | |
| `API_SERVER_KEY` | `iris-local-dev` | Phải khớp với `~/.hermes/.env`; README cảnh báo **đổi giá trị này nếu expose Hermes ra ngoài localhost** |
| `HERMES_HOME` | `~/.hermes` | Tự dò nếu để trống |
| `IRIS_HERMES_SESSION` | `iris-voice` | Phiên Hermes cố định — xem `02-electron-main.md` |
| `IRIS_WAKE_WORD` | — | Bật/tắt wake word on-device |
| `IRIS_HUD_HOTKEY` | `Alt+Space` | Phím tắt toàn cục cho Glass HUD |
| `IRIS_SOUNDS` | `true` | Âm hiệu UI |
| `IRIS_LOAD_TEST_DATA` | `false` | Demo mode (không cần key thật) |

## Bề mặt bảo mật cần lưu ý (quan sát từ code, không phải khẳng định có lỗ hổng)

1. **Khoá mặc định là giá trị demo public**: `API_SERVER_KEY=iris-local-dev`
   hard-code làm mặc định ở cả `main.mjs`, `hermes_client.py` (`api_key: str =
   "iris-local-dev"`) lẫn README. An toàn khi Hermes chỉ bind localhost, nhưng
   là điểm rủi ro rõ ràng nếu người dùng expose gateway ra mạng LAN/Internet mà
   quên đổi khoá — README đã tự cảnh báo điều này.
2. **`contextBridge` + `contextIsolation`**: renderer không có quyền Node trực
   tiếp, mọi thao tác nhạy cảm (đọc/ghi `.env`, gọi Hermes, điều khiển cửa sổ)
   đều đi qua danh sách kênh IPC cố định trong `preload.cjs` — đúng khuyến nghị
   bảo mật Electron hiện đại (không thấy dùng `nodeIntegration: true` trong các
   đoạn đã xem).
3. **On-device only cho camera & wake word**: theo README và cấu trúc code
   (MediaPipe WASM, ONNX runtime chạy trong renderer/worker), khung hình camera
   và audio wake-word không được gửi lên mạng — chỉ audio hội thoại thật (khi
   đã "wake") mới đi tới Gemini Live (Google).
4. **Khoá Gemini và Hermes lưu dạng plaintext** trong `~/.iris/.env` — bình
   thường với công cụ desktop loại này (tương tự nhiều app CLI/dev tool khác),
   nhưng đáng nói với người dùng nếu máy dùng chung.
5. **`HERMES_BIN` override** trong `sidecar/hermes_process.py` cho phép chỉ
   định đường dẫn binary tuỳ ý để khởi chạy bằng `subprocess.Popen` — nếu giá
   trị này từng đến từ nguồn không tin cậy (hiện tại chỉ đọc từ biến môi
   trường/`.env` cục bộ nên rủi ro thấp), cần cẩn trọng không để nó bị điều
   khiển từ xa.

## Setup thủ công (tóm tắt từ README)

```bash
git clone https://github.com/ASHR12/iris.git
cd iris
npm install
npm run dev
```

Bật API server phía Hermes:
```bash
echo 'API_SERVER_ENABLED=true' >> ~/.hermes/.env
echo 'API_SERVER_KEY=iris-local-dev' >> ~/.hermes/.env
hermes gateway restart
```

Sau đó hoàn tất wizard onboarding trong app (nhập key, test kết nối, chọn
giọng, cấp quyền mic) — mọi thứ tự ghi vào `~/.iris/.env`, không cần sửa file
thủ công.
