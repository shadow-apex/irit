# 05 — Luồng dữ liệu end-to-end

## Sơ đồ tổng quát (từ README, khớp với code đã đọc)

```
Người dùng ──voice──> IRIS (Electron main: electron/main.mjs)
IRIS ──16k PCM + tool defs──> Gemini Live
Gemini ──câu hỏi nhanh──> Google Search (built-in)
Gemini ──propose → user xác nhận → submit_hermes_task──> Hermes Agent (local API)
Hermes ──SSE tool events + run status──> IRIS
Hermes ──completion event──> Gemini (qua IRIS bơm system event)
Gemini ──"Hermes đã xong — đây là kết quả"──> Người dùng (giọng nói)
```

## Luồng chi tiết một tác vụ điển hình

1. **Người dùng nói** một yêu cầu hành động ("kiểm tra email chưa đọc và tóm
   tắt việc cần chú ý").
2. `useAudioPipeline` (renderer) bắt PCM 16kHz, gửi qua IPC `live:audio` →
   `sendAudioChunk()` trong `main.mjs` → SDK `@google/genai` đẩy lên WebSocket
   Gemini Live.
3. Gemini nhận diện đây là việc cần Hermes, gọi tool `propose_hermes_task`.
   `handleToolCall` → `executeTool("propose_hermes_task", ...)` →
   `proposeHermesTask()` trong `main.mjs` → gọi `gatePropose()` trong
   `hermesGate.mjs`, lưu stage `awaiting_readback`, trả instructions buộc model
   đọc lại brief và **kết thúc lượt nói**.
4. Gemini nói lại brief bằng giọng, hỏi "Should I send this to Hermes?", rồi
   dừng nói → sự kiện `turnComplete` tới `handleLiveMessage()` →
   `markModelTurnComplete()` → stage chuyển `awaiting_user`.
5. Người dùng nói "ừ, làm đi" → audio chunk mới tới → nơi nhận request này gọi
   `markUserSpoke()` → stage chuyển `confirmable`.
6. Gemini gọi tool `submit_hermes_task` → `executeTool` → `submitHermesTask()`
   trước tiên gọi `claimConfirmedProposal()`; chỉ khi trả `ok: true` mới thực sự
   `POST /v1/runs` tới Hermes với `session_id` cố định (`hermesSessionId()`).
7. Hermes trả `run_id` ngay lập tức. `submitHermesTask` trả kết quả về Gemini
   với instructions ép chỉ nói một câu xác nhận ngắn, **không được** mô tả kết
   quả vì chưa có.
8. `watchHermesRun(runId, task)` bắt đầu polling/stream SSE
   (`streamHermesEvents`) từ Hermes; mỗi tool-call Hermes thực hiện (browser,
   code, file, search...) → `forwardHermesEvent` → `emitEvent()` →
   `emitToRenderer("sidecar:event", ...)` → renderer nhận qua
   `window.iris.onSidecarEvent` → `App.tsx` cập nhật mảng `tasks`/`TaskStep` →
   `WorkCard` vẽ live activity feed kèm thời lượng từng bước.
9. Khi Hermes báo trạng thái kết thúc (`completed/failed/...`),
   `announceHermesCompletion()` bơm một **system event** vào phiên Gemini Live
   → Gemini chủ động cất tiếng báo & tóm tắt kết quả (không chờ người dùng hỏi).
10. Người dùng có thể nói "mở kết quả đó" → Gemini gọi tool UI
    (`buildIrisUiTools()`) → `controlIrisUi()` dùng `findTaskMatches()` (fuzzy
    match trong `src/lib/tasks.ts`) để xác định đúng task, rồi gửi
    `iris:ui-action` xuống renderer để mở `ReaderOverlay`.

## Luồng khởi động lịch sử (mở lại app)

`fetchHermesHistory()` → `listHermesSessions()` lấy phiên gần nhất do Iris tạo
(`source === "api_server"`) → nếu có phiên ghim, `sessionRunsFromTranscript()`
đọc transcript thật từ Hermes, dựng lại từng "run" quá khứ (kèm các bước tool
qua `historyStepsFromToolCalls`) → nạp vào `tasks` trên UI. Vì vậy **Iris không
lưu trạng thái công việc ở phía mình** — Hermes là nguồn sự thật duy nhất, giúp
tránh lệch dữ liệu giữa các lần mở app.

## Luồng Glass HUD

Phím tắt toàn cục (`hudHotkey()`, mặc định `Alt+Space`, đăng ký bằng
`globalShortcut`) → `toggleHud()` → `enterHud()`/`exitHud()` thay đổi thuộc
tính cửa sổ Electron hiện có (`setIgnoreMouseEvents`, background trong suốt,
always-on-top) thay vì tạo cửa sổ mới → gửi `hud:mode` IPC xuống renderer →
`App.tsx` chuyển `uiMode` sang `"hud"` → render `HudShell` thay cho layout
thường (`deck`).
