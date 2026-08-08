# Kế Hoạch Nâng Cấp Iris — J.A.R.V.I.S Upgrade

> **Cập nhật lần cuối:** 2026-07-20 | **Trạng thái:** Gần hoàn chỉnh (F1-F4 DONE, F5 blocked)

---

## Tổng quan trạng thái SAU KHI TRIỂN KHAI

| Tính năng | Backend | Frontend | Trạng thái |
|-----------|---------|----------|------------|
| F1 — Live Screen Vision | DONE | DONE | HOÀN CHỈNH |
| F2 — Minority Report Gestures | DONE | DONE | HOÀN CHỈNH |
| F3 — Ollama Local AI (Super+Shift+L) | DONE | DONE | HOÀN CHỈNH |
| F4 — ChromaDB Second Brain | DONE | DONE | HOÀN CHỈNH |
| F5 — Privacy Cam (Super+Shift+C) | Partial | Partial | BLOCKED: node-virtualcam không tương thích Node 24 |

---

## Hotkeys

| Phím tắt | Tính năng |
|----------|-----------|
| Alt+Space | Toggle Glass HUD (mặc định) |
| Super+Shift+V | Bật/tắt Live Screen Vision |
| Super+Shift+L | Bật/tắt Ollama Local AI |
| Super+Shift+C | Bật/tắt Privacy Cam (blur mặt) |

---

## Tính Năng 1: Live Screen Vision — HOÀN CHỈNH

**Đã hoàn thành 100%:**
- `main.mjs`: hàm `toggleScreenVision()`, emit `vision_state`, hotkey `Super+Shift+V`
- `HudShell.tsx`: Eye icon phát sáng khi vision bật
- `App.tsx`: lắng nghe `vision_state` IPC → setIsVisionEnabled()
- Gemini tool `toggle_screen_vision` đã được khai báo

---

## Tính Năng 2: Minority Report Gestures — HOÀN CHỈNH

**Đã hoàn thành 100%:**
- `useHandControl.ts`: detect shush (Pointing_Up ở trung tâm), pinch (2 tay pinchDistance < 0.05), swipe (Open_Palm dx > 40% trong 500ms)
- `App.tsx` (L774-793): edge-trigger effect gửi `sendHandGesture()` với debounce 1s
- `preload.cjs` (L65): `sendHandGesture: (gesture) => ipcRenderer.send("iris:hand-gesture", gesture)`
- `main.mjs` (L2568-2584): 
  - pinch → mainWindow.minimize() / restore()
  - swipe_left/right → nut-js Super+Ctrl+Arrow (Windows virtual desktop switch)
  - shush → audio.toggleMute() trong renderer trực tiếp

---

## Tính Năng 3: Ollama Local AI — HOÀN CHỈNH

**Đã hoàn thành 100%:**
- `main.mjs`: `submitLocalChat()` dùng `process.env.IRIS_LOCAL_MODEL || "llama3"`
- Gemini tool `submit_local_chat` đã khai báo
- `main.mjs`: hotkey `Super+Shift+L` toggle localchat mode, notify Gemini về chế độ mới
- `.env.example`: docs về `IRIS_LOCAL_MODEL`

**Yêu cầu người dùng:**
- Cài Ollama: https://ollama.ai
- Pull model: `ollama pull llama3` (hoặc qwen2.5:3b, phi3.5, v.v.)
- Set `IRIS_LOCAL_MODEL=<tên model>` trong `.env` nếu muốn đổi default

---

## Tính Năng 4: ChromaDB Second Brain — HOÀN CHỈNH

**Đã hoàn thành 100%:**
- `memory-session.mjs`: `saveToMemory(text)` + `queryMemory(query)` với ChromaDB embedded
- `main.mjs`: import đã có, Gemini tools `save_to_memory` + `query_memory` đã khai báo
- Tool dispatch: `case "save_to_memory"` + `case "query_memory"` trong executeClaudeTool()

**Cách dùng:**
- Nói: "Iris, nhớ điều này: [thông tin]" → lưu vào ChromaDB
- Nói: "Iris, mày có nhớ tao nói gì về X không?" → query_memory tự động được gọi

---

## Tính Năng 5: Privacy Cam — CÒN BỊ BLOCK

**Đã làm:**
- `resources/privacy-cam.html`: hidden renderer, webcam → MediaPipe FaceLandmarker → blur → canvas
- `main.mjs`: hotkey `Super+Shift+C` toggle, mở BrowserWindow ẩn, load đúng file
- Blur logic: canvas filter blur(20px) trên bounding box mặt + 20% padding

**Vấn đề:**
- `node-virtualcam` là native addon (node-gyp) — KHÔNG tương thích Node 24 (v8::AccessorSignature đã bị xoá)
- Chưa có cách đẩy canvas frames vào virtual camera driver trên Windows

**Giải pháp thay thế (chưa implement):**
1. **OBS WebSocket**: Dùng `obs-websocket-js` — gửi frames đến OBS, OBS dùng Browser Source + Virtual Camera
2. **Downgrade Node**: Dùng Node 18/20 LTS → node-virtualcam build được (nhưng xung đột với Electron)
3. **FFmpeg pipe**: Dùng `ffmpeg -f rawvideo` pipe vào v4l2loopback (Linux only)
4. **ShareX/OBS overlay**: Người dùng tự dùng OBS scene với Iris app và virtual cam

**Khuyến nghị:** Tạm thời Privacy Cam chỉ xử lý blur nội bộ (trong cửa sổ ẩn Iris),
chưa thể output ra virtual device để dùng trong Zoom/Zalo.

---

## Kế hoạch triển khai (Task List — FINAL STATUS)

- [x] **Tính năng 1: Live Screen Vision Indicator**
  - [x] Package lucide-react đã cài
  - [x] main.mjs emit vision_state event + Gemini tool toggle_screen_vision
  - [x] main.mjs hotkey Super+Shift+V → toggleScreenVision()
  - [x] HudShell.tsx Eye indicator
  - [x] App.tsx listener vision_state → setIsVisionEnabled(payload.enabled)

- [x] **Tính năng 2: Minority Report Gestures**
  - [x] useHandControl.ts: detect shush, pinch, swipe
  - [x] preload.cjs: sendHandGesture() method
  - [x] App.tsx: edge-trigger useEffect → sendHandGesture (shush → toggleMute trực tiếp)
  - [x] main.mjs: ipcMain.on("iris:hand-gesture") → pinch/swipe handlers với nut-js

- [x] **Tính năng 3: Ollama Local AI (Super+Shift+L)**
  - [x] Package ollama@^0.6.3 đã cài
  - [x] main.mjs: globalShortcut("Super+Shift+L") + notifyIris về mode change
  - [x] main.mjs: submitLocalChat() đọc IRIS_LOCAL_MODEL từ env (default: llama3)
  - [x] Gemini tool submit_local_chat khai báo
  - [x] .env.example: docs IRIS_LOCAL_MODEL

- [x] **Tính năng 4: ChromaDB Second Brain**
  - [x] Package chromadb@^3.5.0 đã cài
  - [x] memory-session.mjs: saveToMemory + queryMemory
  - [x] main.mjs: import + Gemini tools save_to_memory, query_memory
  - [x] executeClaudeTool(): dispatch cases save_to_memory/query_memory

- [/] **Tính năng 5: Privacy Cam (Super+Shift+C) — BLOCKED**
  - [x] resources/privacy-cam.html: MediaPipe FaceLandmarker blur renderer
  - [x] main.mjs: hotkey Super+Shift+C + BrowserWindow ẩn load privacy-cam.html
  - [ ] BLOCKED: node-virtualcam không build trên Node 24 — cần giải pháp thay thế

---

## Gói npm đã cài

| Gói | Phiên bản | Trạng thái |
|-----|-----------|------------|
| ollama | ^0.6.3 | OK |
| chromadb | ^3.5.0 | OK |
| lucide-react | latest | OK |
| @nut-tree-fork/nut-js | ^4.2.6 | OK |
| node-virtualcam | N/A | FAIL: không tương thích Node 24 |
