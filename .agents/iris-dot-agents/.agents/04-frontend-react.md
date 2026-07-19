# 04 — Frontend React (`src/`)

## `App.tsx` (~1068 dòng) — "nhạc trưởng" của UI

Không dùng Redux/Zustand — toàn bộ state nằm trong `useState` ở component gốc
`App`, khá nhiều (>20 state field), gồm các nhóm:

- **Trạng thái kết nối**: `sidecarRunning`, `sidecarPid`, `geminiStatus`,
  `hermesStatus`, `audioState`.
- **Nội dung hội thoại**: `transcript` (mảng `TranscriptLine`), `logs`.
- **Công việc (Work Stream)**: `tasks` (mảng `TaskCard`), `expandedTaskId`,
  `focusedTaskId`, `taskChooser` (khi voice-command khớp mờ nhiều task, hiện
  bảng chọn), `stepsOpenIds`, `showHistory`.
- **Điều khiển tay**: `handControl` (bật/tắt), truyền vào `useHandControl`.
- **Cấu hình / setup**: `fullConfig`, `setup` (`onboarding` hay `settings`),
  `wakeWordEnabled`, `hermesSession`, `testDataEnabled` (demo mode).
- **Chế độ hiển thị**: `uiMode` (`deck` = cửa sổ thường / `hud` = overlay
  trong suốt), `bootActive`/`bootClosing` (màn hình khởi động cinematics).
- **Hiệu ứng orb**: `orbThinking`, `wakeKey`, `rippleKey` (dùng làm "key" để
  React re-trigger animation), `soundsEnabled`.

`hasBridge = typeof window.iris !== "undefined"` — mọi giao tiếp với main
process đi qua đối tượng `window.iris` được `electron/preload.cjs` expose an
toàn (context isolation) thay vì `require('electron')` trực tiếp trong renderer.

Các hook tuỳ biến được compose vào `App`:
- `useAudioPipeline(hasBridge, pushLog)` — quản lý mic capture/playback.
- `useHandoffFx(tasks, orbStageRef, workScrollRef, {onDelegate, onComplete})` —
  sinh hiệu ứng "particle streak" (comet) khi task được giao/hoàn thành, đồng
  thời kích hoạt sound cue tương ứng.
- `useHandControl(enabled)` — theo dõi cử chỉ tay qua MediaPipe.
- `useWakeWord(...)` — chạy mô hình ONNX "Hey Iris" trên luồng audio nền.

## `src/hooks/`

| Hook | Trách nhiệm |
|---|---|
| `useAudioPipeline.ts` (185 dòng) | Bắt âm thanh mic (WebRTC echo cancellation), chuyển PCM 16kHz gửi lên main qua IPC (`live:audio`), phát PCM 24kHz nhận về, đo mức âm lượng (metering) để orb "thở" theo audio thật. |
| `useHandControl.ts` (265 dòng) | Chạy `@mediapipe/tasks-vision` `GestureRecognizer` trên khung camera, nhận diện point/open-palm/fist, tính toạ độ con trỏ ảo, "dwell" 300ms (`DWELL_MS` ở `App.tsx`) để mô phỏng click. |
| `useHandoffFx.ts` (145 dòng) | Thuần hiệu ứng thị giác — sinh "pulse" (particle) bay từ orb tới task card và ngược lại khi có thay đổi trong mảng `tasks`; không đụng vào logic voice/task thật (ghi rõ trong `types.ts`). |
| `useWakeWord.ts` (227 dòng) | Suy luận on-device bằng `onnxruntime-web`: mel-spectrogram → embedding → classifier, phát hiện "Hey Iris" để tự động "wake" app mà không cần giữ mic mở liên tục lên Gemini. |

## `src/components/`

| Component | Vai trò |
|---|---|
| `TopBar.tsx` | Thanh trên: nút HUD toggle, Settings, bật/tắt hand-tracking, trạng thái kết nối. |
| `CenterStage.tsx` (174 dòng) | Khu vực trung tâm chứa orb (`ReactorCore`) + transcript. |
| `ReactorCore.tsx` (377 dòng, **file component lớn nhất**) | "Orb" vẽ bằng `<canvas>` — vòng cung "arc reactor" phản ứng theo mức audio thực, đổi bảng màu theo state (`listening/speaking/working`), có "double-pulse" khi wake, "ripple" khi câu nói được chốt, "thinking swirl" khi chờ Gemini trả lời. |
| `CommsPanel.tsx` | Panel hiển thị transcript hội thoại. |
| `WorkStream.tsx` / `WorkCard.tsx` | Danh sách task đang/đã chạy; mỗi `WorkCard` hiện tiến trình, các bước tool-call live, nút mở kết quả. |
| `ReaderOverlay.tsx` (207 dòng) | Cửa sổ đọc kết quả task dạng overlay kính (glass), điều khiển được bằng 2 tay mở (resize) / nắm tay (đóng). |
| `SessionSwitcher.tsx` (160 dòng) | Chip chọn phiên Hermes ở đầu Work Stream + nút "+" tạo phiên mới. |
| `HistoryDrawer.tsx` | Ngăn kéo xem lịch sử các phiên/kết quả cũ. |
| `TaskChooser.tsx` | Bảng chọn khi lệnh giọng nói ("mở kết quả gần nhất") khớp mờ nhiều task cùng lúc. |
| `HandoffLayer.tsx` / `HandReticles.tsx` | Vẽ hiệu ứng particle handoff và con trỏ tay (reticle) "sạc" khi dwell-click. |
| `CameraDock.tsx` | Ô xem trước camera nhỏ khi bật hand-tracking. |
| `BootSequence.tsx` | Màn hình khởi động cinematics khi mở app. |
| `SetupPanel.tsx` (704 dòng, **lớn thứ 2**) | Wizard onboarding + màn hình Settings đầy đủ: nhập Gemini key (nút Test), trỏ Hermes URL/key (nút Test), chọn + nghe thử giọng, cấp quyền mic, bật demo mode, bật wake word, đổi hotkey HUD... Ghi xuống `~/.iris/.env` qua IPC `config:save`. |
| `HudShell.tsx` (270 dòng) | Bố cục riêng cho chế độ Glass HUD: chip Tasks/Comms có thể thu gọn, camera tile, caption pill cạnh orb. |

## `src/lib/`

- `tasks.ts` (222 dòng) — tiện ích thuần cho `TaskCard`/`TaskStep`:
  - `isActiveTask`, phân loại `toolCategory`/`prettyToolName` (đặt tên đẹp cho
    tool Hermes để hiện trên UI), `stepDetail`/`stepHeadline`.
  - `findTaskMatches(query, tasks)` — **fuzzy matching** tự viết tay (có
    `editDistance` — Levenshtein — và `fuzzyTokenMatch`) để ánh xạ câu lệnh
    giọng nói mơ hồ ("mở cái vừa xong", "cái bị lỗi ấy") sang task đang hiển thị.
    Đây là hàm được cả main process (`controlIrisUi`) lẫn UI dùng chung logic.
- `audio.ts` (36 dòng) — helper chuyển đổi PCM/Float32 cho audio pipeline.
- `sounds.ts` (110 dòng) — 5 âm hiệu UI tổng hợp thuần bằng Web Audio API
  (không dùng file audio), theo đúng mô tả README ("pure tuned Web Audio
  tones"): wake, sleep, task sent, task done, approval needed.
- `uiTestData.ts` (209 dòng) — dữ liệu giả (`makeUiTestData`) cho **demo mode**
  (phím `D`/`G`, bật ở Settings → Advanced) — cho phép dùng thử toàn bộ UI mà
  không cần Gemini key hay Hermes thật.

## `src/types.ts`

Định nghĩa kiểu trung tâm dùng xuyên suốt UI: `ReactorState`
(`idle|online|listening|speaking|working`), `TaskStep`, `TaskCard`, `LogLine`,
`TranscriptLine`, và các kiểu phục vụ hiệu ứng handoff thuần thị giác
(`HandoffTone`, `Pulse`) — tách biệt rõ ràng khỏi state logic thật.

## `src/styles/`

Hệ thống thiết kế "deep-space": tokens (biến CSS) → base → deck (chế độ cửa sổ
thường) → overlays (reader, history...) → fx (hiệu ứng) → hud (chế độ overlay
trong suốt). Không dùng framework CSS ngoài (Tailwind…), là CSS thuần tự viết.

## Giao tiếp renderer ↔ main

- `electron/preload.cjs` — expose `window.iris` (contextBridge) với tập API an
  toàn (invoke các kênh IPC liệt kê ở `02-electron-main.md`), thay vì cho
  renderer truy cập Node API trực tiếp (đúng khuyến nghị bảo mật Electron).
