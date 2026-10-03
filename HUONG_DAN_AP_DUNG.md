# Hướng dẫn áp dụng bản sửa

## 1. File SỬA LỖI conflict Git (bắt buộc — app không chạy được nếu thiếu)

Copy đè các file sau vào đúng vị trí trong repo (giữ nguyên đường dẫn):

| File | Lỗi gốc |
|---|---|
| `package.json` | Conflict marker `<<<<<<<` khiến JSON không hợp lệ → `npm install` fail |
| `package-lock.json` | Conflict marker tương tự |
| `electron/main.mjs` | Conflict marker → SyntaxError khi Electron khởi động |
| `electron/preload.cjs` | Conflict marker → SyntaxError |
| `scripts/run-electron.mjs` | Conflict marker → SyntaxError |
| `src/App.tsx` | Conflict marker → Vite build fail |
| `src/components/ReactorCore.tsx` | Conflict marker → Vite build fail |

Tất cả đã được gộp theo hướng giữ nhánh `HEAD` (nhánh có tính năng Music Widget đầy đủ, đã được `MusicWidget.tsx` và package `windows-media-sessions` sử dụng thật trong code — nhánh còn lại chỉ là bản cũ hơn/rút gọn).

Sau khi copy đè, chạy lại:
```bash
npm install
npm run dev
```

## 2. File MỚI + SỬA để nối `/tools` (script Python) trực tiếp vào Gemini Live

| File | Thay đổi |
|---|---|
| `electron/main/local-tools.mjs` | **File mới** — bọc 6 script Python (`ai_vision.py`, `clipboard_manager.py`, `magic_move.py`, `notifier.py`, `sys_control.py`, `sys_monitor.py`) thành hàm Node gọi được |
| `electron/main/tool-dispatcher.mjs` | Thêm import + 7 case mới gọi tới `local-tools.mjs` |
| `electron/main/claude-tools-catalog.mjs` | Khai báo 7 tool mới cho Gemini Live (function-calling schema) |
| `electron/main/gemini-live.mjs` | Thêm đoạn hướng dẫn trong system prompt để Gemini **biết khi nào tự gọi** các tool này |

### 7 tool mới Gemini có thể tự gọi (không cần qua Claude):
- `take_ai_screenshot` — chụp màn hình 1 lần và xem ngay (khác `toggle_screen_vision` là stream liên tục)
- `read_clipboard` / `write_clipboard` — đọc/ghi clipboard
- `move_window_magic` — di chuyển cửa sổ (mode: active/name/demo)
- `send_desktop_notification` — bắn thông báo Windows Toast
- `system_control` — âm lượng / độ sáng / wifi / bluetooth / camera
- `system_monitor` — CPU / RAM / ổ đĩa / pin

### Lưu ý quan trọng
- `tools/move_window.py` **cố tình không nối** vì không có SKILL.md tương ứng và trùng chức năng với `magic_move.py` (đã nối rồi). Nếu bạn vẫn muốn dùng, báo mình để thêm case `move_window_precise`.
- `system_control` khi bật/tắt wifi/bluetooth/camera sẽ hiện UAC — Gemini sẽ tự nhắc bạn bấm "Yes".
- `take_ai_screenshot` dùng lại đúng hàm `sendFrameToGemini` sẵn có (import động để tránh vòng lặp import giữa `gemini-live.mjs` ↔ `tool-dispatcher.mjs` ↔ `local-tools.mjs`).
- Máy chạy Iris phải có `python` trong PATH và đã cài đủ package cho các script (`pyautogui`, `pyperclip`, `pygetwindow`, `plyer`, `psutil`...). Nếu máy bạn dùng lệnh `python3` thay vì `python`, set biến môi trường `IRIS_PYTHON_BIN=python3` trong `.env`.

## 3. Việc CHƯA làm (nói để bạn quyết định)
- Chưa chạy `npm run build` / `tsc --noEmit` thật trên máy bạn (sandbox này không cài đủ `node_modules` để build đầy đủ Electron+Vite) — nên sau khi thay file, nhớ chạy `npm run build` một lần để chắc chắn không còn lỗi TypeScript nào khác ẩn trong 2 file `.tsx`.
- Chưa rà hết toàn bộ repo (170MB, rất nhiều module) — chỉ tập trung vào đúng phạm vi bạn hỏi (conflict chặn chạy app + liên kết `/tools` với Gemini Live). Nếu muốn, mình rà tiếp các phần khác (`sidecar/`, `iris-companion/`, `PHONE_CAMERA/`...).
