# 02 — Electron Main Process (`electron/main.mjs`, ~1474 dòng)

Đây là "bộ não" điều phối của toàn app. Chạy trong tiến trình Node của Electron
(main process), giữ session Gemini Live, gọi Hermes API, quản lý cửa sổ.

## Các nhóm chức năng chính (theo thứ tự xuất hiện trong file)

### 1. Cấu hình / env (`parseEnvFile`, `loadEnvFile`, `appConfig`, `getFullConfig`,
`writeUserConfig`, `userConfigPath`, `serializeConfigValue`)
- Đọc `.env` theo thứ tự ưu tiên: `.env` trong repo (dev) → `~/.iris/.env`
  (do setup wizard ghi) → `.env` đóng gói kèm app.
- `writeUserConfig` là nơi UI Settings ghi thay đổi xuống `~/.iris/.env`.

### 2. Kiểm thử kết nối (dùng bởi màn hình Setup/Onboarding)
- `testGeminiKey(candidateKey)` — thử tạo phiên nhanh với key nhập vào.
- `testHermesConnection(payload)` — ping Hermes health endpoint.
- `previewVoice(payload)` — phát thử 1 giọng đọc Gemini Live để người dùng chọn.

### 3. Cầu nối Hermes (Hermes bridge)
- `hermesBaseUrl()` → mặc định `http://127.0.0.1:8642` (từ `HERMES_API_URL`).
- `hermesRequest(method, path, body)` — wrapper `fetch` chung, ném lỗi khi
  `!response.ok`.
- `checkHermesStatus()` → gọi `/health`.
- `hermesSessionId()` → **luôn** trả về 1 session cố định (`IRIS_HERMES_SESSION`,
  mặc định `"iris-voice"`). Comment trong code giải thích: trước đây Gemini được
  tự chọn `session_id` và vô tình tạo nhiều thread rác trong Hermes — nay bị khoá
  cứng, model không còn quyền quyết định việc này.
- `submitHermesTask({task, urgency})` — `POST /v1/runs` với `session_id` cố định
  và một đoạn "instructions" ép Hermes làm việc tự động (không hỏi lại Iris trừ
  khi không thể), đồng thời tận dụng lại kết quả các lần chạy trước trong cùng
  session. Trả `run_id` ngay lập tức rồi gọi `watchHermesRun` để theo dõi nền.
- `getHermesTaskStatus({run_id})` — `GET /v1/runs/:id`; nếu trạng thái không nằm
  trong tập kết thúc (`completed/failed/cancelled/canceled/error`) thì trả về chỉ
  dẫn ép model nói "vẫn đang chạy", không được đoán kết quả.
- `stopHermesTask`, `approveHermesAction` — các thao tác điều khiển run khác.

### 4. Cổng xác nhận 2 bước — **điểm kiến trúc quan trọng nhất repo**
File `electron/hermesGate.mjs` (tách riêng, ~50 dòng) chứa một **state machine
nhỏ, thuần dữ liệu**, độc lập với prompt của model:

```
awaiting_readback -> (lượt nói của model kết thúc) -> awaiting_user
awaiting_user      -> (người dùng nói)              -> confirmable
```

- `proposeHermesTask(task, urgency)` (trong `hermesGate.mjs`) chỉ **lưu tạm**
  (`stage: "awaiting_readback"`), có TTL 5 phút (`PROPOSAL_TTL_MS`).
- `markModelTurnComplete()` được gọi khi Gemini kết thúc lượt nói (đọc lại brief
  cho người dùng nghe) → chuyển sang `awaiting_user`.
- `markUserSpoke()` được gọi khi audio người dùng thực sự tới → chuyển sang
  `confirmable`.
- `claimConfirmedProposal()` — hàm duy nhất thực sự "tiêu thụ" đề xuất để gọi
  `submitHermesTask`; chỉ thành công nếu stage đang là `confirmable`.

→ Nói cách khác: **model không thể tự "xác nhận" chính nó trong cùng một lượt
nói**. Phải có tối thiểu: (1) model đề xuất, (2) model dừng nói, (3) người dùng
nói gì đó (bất kỳ, miễn là một lượt nói mới) thì đề xuất mới "khả dụng" để gửi.
Đây chính là điều README gọi là "Enforced in code, not by prompt hopes."

Hàm cấp cao `proposeHermesTask({task, urgency})` trong `main.mjs` (khác với hàm
cùng tên trong `hermesGate.mjs`) gọi `gatePropose` rồi trả về instructions yêu
cầu model đọc brief, hỏi "Should I send this to Hermes?", và **kết thúc lượt
nói ngay** — không được gọi `submit_hermes_task` trong cùng lượt.

### 5. Phiên & lịch sử Hermes
- `createHermesSession()` — tạo thread mới, để Hermes tự đặt tên (giống mọi công
  cụ chat khác: tên lấy từ tin nhắn đầu tiên).
- `listHermesSessions()` — chỉ liệt kê session có `source === "api_server"`
  (tức do Iris tạo), **loại trừ** các phiên TUI/desktop riêng của người dùng.
  Giới hạn 25 phiên gần nhất.
- `sessionRunsFromTranscript`, `historyStepsFromToolCalls`, `fetchHermesHistory`
  — dựng lại "Work Stream" (danh sách task đã hoàn thành) từ transcript thật của
  Hermes mỗi lần mở app, thay vì lưu state riêng ở phía Iris → đảm bảo không mất
  dữ liệu giữa các lần chạy và tránh lệch trạng thái.

### 6. Sự kiện thời gian thực & luồng tool-call của Gemini
- `buildHermesTools()` — định nghĩa các tool Gemini Live có thể gọi:
  `propose_hermes_task`, `submit_hermes_task`, `get_hermes_task_status`,
  `stop_hermes_task`, `approve_hermes_action`, ...
- `buildIrisUiTools()` / `controlIrisUi()` / `getIrisUiContext()` — bộ tool riêng
  cho phép Gemini **điều khiển UI bằng giọng nói** (mở kết quả mới nhất, hiện các
  bước, đóng reader...), khớp mờ (fuzzy match) với danh sách task đang hiển thị
  trên màn hình (dùng `findTaskMatches` từ `src/lib/tasks.ts`).
- `executeTool(name, args)` — bộ định tuyến (dispatcher) trung tâm nối tên tool
  Gemini gọi với hàm JS thực thi tương ứng.
- `forwardHermesEvent`, `streamHermesEvents`, `watchHermesRun` — tiêu thụ luồng
  SSE (Server-Sent Events) từ Hermes, chuyển từng bước công cụ (tool call) thành
  sự kiện gửi tới renderer để vẽ "live activity feed" trên task card.
- `announceHermesCompletion` — khi Hermes xong việc, bơm một "system event" vào
  phiên Gemini Live để nó **chủ động** báo lại bằng giọng nói (đúng như README mô
  tả: "Quick update — Hermes is back with the result.").

### 7. Phiên Gemini Live
- `buildLiveConfig()` — cấu hình model, giọng nói, system instruction, danh sách
  tool.
- `userContextParts()` / `loadUserContext()` — đọc `USER.md`, `MEMORY.md` của
  chính Hermes (bộ nhớ cá nhân hoá) để đưa vào ngữ cảnh hệ thống của Gemini, giúp
  Iris "biết" người dùng mà không cần định nghĩa lại.
- `startLive()` / `stopLive()` — mở/đóng phiên Gemini Live thật (SDK
  `@google/genai`), gắn các callback nhận audio, tool call, transcript.
- `handleToolCall(toolCall)` — nhận lệnh gọi tool từ Gemini, chạy qua
  `executeTool`, trả kết quả lại cho Gemini.
- `handleLiveMessage(message)` — xử lý sự kiện thô từ WebSocket Gemini Live
  (audio chunk, transcript, turnComplete...). Đây cũng là nơi gọi
  `markModelTurnComplete()` khi turn kết thúc.
- `sendAudioChunk(arrayBuffer)` — nhận PCM 16kHz từ renderer, gửi lên Gemini.

### 8. Cửa sổ, Glass HUD, tray, phím tắt
- `createWindow()` — cửa sổ chính Electron (frameless, có thể trong suốt).
- `enterHud()` / `exitHud()` / `toggleHud()` — chuyển cửa sổ sang chế độ overlay
  trong suốt, click-through, always-on-top; dùng API `setIgnoreMouseEvents` của
  Electron để "xuyên chuột" ngoại trừ vùng UI của Iris.
- `createTray()`, `updateTrayMenu()` — icon khay hệ thống với menu wake/sleep/HUD.
- `hudHotkey()` — đọc `IRIS_HUD_HOTKEY` (mặc định `Alt+Space`), đăng ký bằng
  `globalShortcut.register` trong `app.whenReady()`.
- `installAppMenu()` — menu ứng dụng chuẩn (macOS/Windows).

### 9. Đăng ký IPC (`app.whenReady().then(...)`, dòng ~1411-1450)
Danh sách kênh IPC chính (renderer ↔ main):
```
sidecar:start / sidecar:stop / sidecar:status   -> điều khiển phiên Gemini Live
app:config / config:get / config:save            -> đọc/ghi cấu hình
config:test-gemini / config:test-hermes / config:preview-voice -> wizard setup
hermes:history / hermes:sessions / hermes:create-session
hud:toggle / hud:interactive / win:control        -> điều khiển cửa sổ/HUD
sidecar:command / live:audio                      -> lệnh & audio realtime
iris:boot-done                                    -> renderer báo xong boot sequence
                                                      -> trigger sendWelcomeGreeting()
iris:ui-context                                    -> renderer gửi context UI hiện tại
                                                      lên main để phục vụ voice-UI control
```

## Điểm cần lưu ý khi sửa code

- **Không được bỏ qua `hermesGate.mjs`** khi thêm đường dẫn mới để submit task —
  nếu thêm một cách khác để gọi `submitHermesTask` mà không qua
  `claimConfirmedProposal`, sẽ phá vỡ "nguyên tắc vàng" mà README nhấn mạnh:
  "Iris never invents Hermes results" và "voice must never regress".
- `hermesSessionId()` bị khoá cứng theo thiết kế — đừng "sửa lại" cho model tự
  chọn session, đó là fix có chủ đích cho một bug đã biết.
- Tool call của Gemini Live là đồng bộ (synchronous) — comment trong README nhấn
  mạnh không được block một tool call bằng việc chờ Hermes chạy xong; phải trả
  `run_id` ngay rồi theo dõi nền (`watchHermesRun`).
