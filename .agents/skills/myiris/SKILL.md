---
name: myiris
description: >
  Kien thuc day du ve du an myiris (Iris) — mot AI voice companion
  de dieu khien may tinh bang giong noi, ra lenh cho Claude Code lam viec
  ngam, dieu khien tay bang camera, va quan ly workstream phat trien phan mem.
  Kich hoat skill nay khi nguoi dung hoi ve myiris/irit, Iris, cach cai dat/chay/
  cau hinh/sua/mo rong du an nay (repo: github.com/shadow-apex/irit — fork cua
  myiris, duong dan cai dat tuy may nguoi dung, khong co dinh).
---

# Skill: myiris (Iris Voice AI Companion)

## Tong quan du an

**Iris** la mot desktop voice companion dang Electron + React + TypeScript + Vite.

- **Tac gia ban fork**: MRQ Hoc Ung Dung AI (fork tu ASHR12/iris)
- **Repo hien tai**: `github.com/shadow-apex/irit` (fork tiep theo cua myiris — ten
  thu muc/duong dan cai dat se khac nhau tuy may moi nguoi, dung gia dinh duong
  dan co dinh)
- **License**: MIT
- **Tested on**: macOS M4 (chay duoc ca Windows/Linux)
- **Chay tren Windows**: Fully supported
- **Kien truc hien tai**: J.A.R.V.I.S Upgrade (cap nhat 2026-07-20)

### Iris lam duoc gi? (J.A.R.V.I.S Upgrade)

1. **Dieu khien may tinh bang giong noi** — noi voi Iris, Iris nghe realtime qua Gemini Live
2. **Tu dong mo App & URL** — Gemini goi tool `open_url_or_app` de mo trinh duyet / ung dung Windows (an toan, co whitelist)
3. **Giao viec cho Claude Code** — Gemini route cong viec phuc tap sang Claude headless (`claude -p`)
4. **Live Screen Vision** — Gemini nhin thay man hinh realtime qua WebRTC stream (Super+Shift+V)
5. **Dieu khien tay bang camera** — MediaPipe GestureRecognizer: Pinch, Swipe, Shush, Pointing, Palm, Fist
6. **Ollama Local AI** — fallback sang mo hinh AI cuc bo, khong internet (Super+Shift+L)
7. **ChromaDB Second Brain** — luu va truy van ky uc bang `save_to_memory` / `query_memory`
8. **Privacy Cam** — nhan dien khuon mat va lam mo tu dong (MediaPipe FaceLandmarker, 15fps)
9. **Glass HUD overlay** — float over toan man hinh nhu overlay trong suot
10. **Wake word "Hey Iris"** — ONNX on-device wake word detection
11. **Pipeline phat trien PO -> DEV** — Iris la voice-controlled software development pipeline

---

## Kien truc tong the (J.A.R.V.I.S Upgrade)

```
User noi -> Electron Renderer (WebRTC AEC mic)
         -> Electron Main -> Gemini Live API (models/gemini-3.1-flash-live-preview)
         -> Gemini quyet dinh route:
              |-- Google Search (cau hoi nhanh, fact)
              |-- open_url_or_app -> shell.openExternal / spawn cmd.exe [whitelist]
              |-- toggle_screen_vision -> WebRTC screen stream -> Gemini nhin man hinh
              |-- submit_claude_task -> Claude Code headless (claude -p)
              |                      -> NDJSON stream -> Work Stream panel
              |                      -> SYSTEM_EVENT_CLAUDE_COMPLETE -> Gemini thong bao
              |-- submit_local_chat -> Ollama local AI (localhost:11434)
              |-- save_to_memory / query_memory -> ChromaDB local
              |-- start_computer_use_task -> computer-session.mjs (Claude Computer Use)
              |-- go_to_sleep -> iris:sleep event

Renderer song song:
  |-- useHandControl.ts -> MediaPipe GestureRecognizer (webcam, GPU)
  |                     -> Pinch (2 tay) -> minimize window
  |                     -> Swipe Open_Palm -> chuyen desktop (nut-js)
  |                     -> Shush (pointing giua man hinh) -> mute mic
  |-- Privacy Cam -> BrowserWindow an -> FaceLandmarker 15fps -> blur faces
```

---

## Cau truc thu muc

> **[THÔNG BÁO] Sơ đồ hình cây chi tiết:** Vì dự án có rất nhiều file, sơ đồ toàn bộ các file đã được tạo tự động và lưu riêng tại **[references/project_tree.md](references/project_tree.md)** (đường dẫn tương đối trong repo — không dùng đường dẫn tuyệt đối vì mỗi máy clone repo vào một chỗ khác nhau). Được cập nhật lại lần cuối 2026-08-02; chạy lại `python3` script mô tả ở đầu file đó nếu cấu trúc thay đổi nhiều.

Dưới đây là sơ đồ rút gọn của các file cốt lõi nhất:

```
irit/
|-- electron/
|   |-- main.mjs          # TRUNG TAM: Gemini Live, Claude bridge, HUD, Tray, tools (~5100 lines —
|   |                      # da tach mot phan sang cac module ben duoi, nhung van la file lon nhat)
|   |-- preload.cjs       # IPC bridge -> window.iris (audio, sidecar events, session controls)
|   |-- po-session.mjs    # Module PO: Agent SDK stateful session (persistent)
|   |-- study-session.mjs # Module STUDY: Agent SDK stateful session (isolated)
|   |-- memory-session.mjs# ChromaDB: saveToMemory / queryMemory
|   |-- computer-session.mjs # Claude Computer Use: screen capture + mouse/kb control
|   |-- run-queue.mjs     # Hang doi chay tung task mot (PO + DEV share same slot)
|   |-- claude-stream.mjs # Parse NDJSON stream tu claude -p
|   |-- renderer-security.mjs # Chan navigation + gioi han quyen mic/cam theo dung origin
|   |-- action-lane.mjs, browser-agent.mjs, canvas-mcp.mjs, canvas-store.mjs,
|   |   companion-server.mjs, smarthome-rules.mjs, task-review.mjs, telegram-bot.mjs,
|   |   vault-graph.mjs, vault-graph-parse.mjs, atomic-file.mjs # cac module da tach khac
|   |-- capabilities/     # canvas.mjs, second-brain.mjs — dang { channel, kind, fn } IPC
|-- src/
|   |-- App.tsx            # Renderer chinh (~1870 lines): mic, audio, UI, gestures
|   |-- components/
|   |   |-- HudShell.tsx   # Glass HUD overlay
|   |   |-- ReactorCore.tsx# Orb animation (Three.js)
|   |   |-- CenterStage.tsx# Icon bung sang khi Screen Vision bat
|   |   |-- WorkStream.tsx # Panel hien thi Claude tasks
|   |   |-- SetupPanel.tsx # UI setup/config
|   |   |-- ...
|   |-- hooks/
|   |   |-- useHandControl.ts  # MediaPipe GestureRecognizer hook (Pinch/Swipe/Shush)
|   |   |-- useWakeWord.ts     # ONNX wake word detection
|   |   |-- useAudioPipeline.ts# WebRTC mic -> 16kHz PCM
|   |   |-- useHandoffFx.ts    # Handoff animation
|   |-- types.ts
|-- resources/
|   |-- privacy-cam.html  # Cua so an: FaceLandmarker 15fps, blur khuon mat
|   |-- personas/
|       |-- iris-po.md    # Claude agent: Product Owner
|       |-- iris-dev.md   # Claude agent: Developer
|       |-- iris-study.md # Claude agent: Study
|-- openspec/         # Living spec (SDD surface)
|-- wakeword-models/  # ONNX models: melspectrogram, embedding, hey_iris
|-- public/wakeword/  # Bundled wakeword models
|-- .env.example      # Template env vars
|-- CLAUDE.md         # Huong dan cho Claude Code khi lam viec voi repo nay
|-- README.md         # Tai lieu day du
|-- ARCHITECTURE_PLAN.md # Ke hoach kien truc J.A.R.V.I.S Upgrade
```

---

## Cac file quan trong nhat

### `electron/main.mjs` (~5100 dong)
Day la trai tim cua toan bo he thong:
- Tao Gemini Live session (`@google/genai`)
- Khai bao **15+ Gemini tools**:
  - `open_url_or_app` — mo web/app (co whitelist bao mat, dung spawn shell:false)
  - `toggle_screen_vision` — bat/tat WebRTC screen stream
  - `start_computer_use_task` — Claude Computer Use
  - `submit_claude_task` — giao viec cho Claude (PO/DEV/STUDY)
  - `check_claude_status`, `get_claude_task_status`, `stop_claude_task`
  - `start_new_claude_session`, `get_workspace_info`, `answer_po_question`
  - `submit_local_chat` — Ollama local AI
  - `save_to_memory`, `query_memory` — ChromaDB Second Brain
  - `set_agent_model`, `get_ui_context`, `control_ui`, `go_to_sleep`
- Bridge Gemini tool calls -> headless Claude
- Glass HUD: `enterHud()`, `exitHud()`, `toggleHud()`
- Global hotkeys: `Alt+Space` (HUD), `Super+Shift+V` (Screen Vision), `Super+Shift+L` (Local AI)
- Privacy Cam: BrowserWindow an load `resources/privacy-cam.html`
- Quan ly Claude sessions (persist tai `~/.iris/claude-sessions.json`)

### `electron/memory-session.mjs`
ChromaDB local:
- `saveToMemory(text)` — nhung va luu text vao ChromaDB
- `queryMemory(query)` — semantic search trong ky uc

### `electron/computer-session.mjs`
Claude Computer Use:
- Chup man hinh -> base64 -> Claude API
- Dieu khien mouse/keyboard theo lenh Claude

### `resources/privacy-cam.html`
Cua so BrowserWindow an (invisible):
- MediaPipe FaceLandmarker (GPU delegate)
- Nhan dien khuon mat -> ve blur filter tren canvas
- Thong so hien tai: 15fps (throttled), 640x480, numFaces: 2

### `src/hooks/useHandControl.ts`
MediaPipe gesture hook (J.A.R.V.I.S Upgrade):
- `Pointing_Up` -> move cursor, dwell 850ms -> open task card
- `Open_Palm` -> hold-to-scroll reader; swipe nhanh -> doi desktop (nut-js)
- `Closed_Fist` -> close reader
- **Pinch** (2 tay cung luc, pinchDistance < 0.05) -> thu nho cua so
- **Shush** (pointing giua man hinh, y < 40% height) -> mute/unmute mic
- GPU delegate, 640x480, exponential smoothing (0.5), 3-frame stabilization
- swipeHistory co hard cap 120 entries (tranh memory leak)

---

## Bao mat: `open_url_or_app` (QUAN TRONG)

Tool nay da duoc viet lai an toan voi:
1. **`ALLOWED_URL_PROTOCOLS`** — chi cho phep `https:` va `http:`. Chan `file://`, `javascript:`, custom protocols.
2. **`ALLOWED_APP_EXECUTABLES`** — whitelist 19 exe duoc phep. Gemini chi mo duoc nhung cai trong danh sach nay.
3. **`spawn("cmd.exe", [...], { shell: false })`** — khong dung `exec()` voi shell string interpolation (tranh command injection).
4. **Basename extraction** — strip duong dan truoc khi kiem tra whitelist (tranh path traversal).

De them app moi vao whitelist: chinh sua `ALLOWED_APP_EXECUTABLES` trong `electron/main.mjs`.

---

## Global Hotkeys (J.A.R.V.I.S Upgrade)

| Phim | Chuc nang |
|------|-----------|
| W (trong app) | Wake — khoi dong Gemini Live + mic + camera |
| S (trong app) | Sleep — dung moi thu |
| Alt+Space | Toggle Glass HUD (override bang IRIS_HUD_HOTKEY) |
| Super+Shift+V | Toggle Live Screen Vision (bat/tat stream man hinh cho Gemini) |
| Super+Shift+L | Toggle Local AI mode (chuyen qua Ollama) |

---

## Dieu khien tay (J.A.R.V.I.S Upgrade)

| Cu chi | Hanh dong |
|--------|-----------|
| Pointing Up (ngon tro len) | Di chuyen cursor; dwell ~850ms -> mo task card |
| Open Palm (mo ban tay) | Hold-to-scroll; swipe nhanh -> chuyen desktop |
| Closed Fist (nam tay) | Dong reader |
| Pinch (ca 2 tay cung pinch) | Thu nho cua so hien tai |
| Shush (pointing giua man hinh) | Mute/unmute mic |

Camera tu dong bat sau khi Wake (W). Co the toggle thu cong bang icon tay tren goc phai.

---

## Env Variables (.env)

```bash
# REQUIRED
GEMINI_API_KEY=your_google_ai_studio_key

# Recommended
IRIS_USER_NAME=there
GEMINI_LIVE_MODEL=models/gemini-3.1-flash-live-preview
GEMINI_LIVE_VOICE=Zephyr
CLAUDE_CODE_OAUTH_TOKEN=<tu: claude setup-token>  # Required cho PO + STUDY

# Optional
IRIS_CLAUDE_CWD=C:\Users\vanha\.iris\workspace
IRIS_CLAUDE_PERMISSION_MODE=bypassPermissions
IRIS_CLAUDE_BIN=C:\Users\vanha\AppData\Local\Programs\claude\claude.exe
IRIS_HUD_HOTKEY=Alt+Space
IRIS_WAKE_WORD=1
IRIS_SLEEP_DELAY_MS=3000
IRIS_PO_QUESTION_TIMEOUT_MS=300000
IRIS_PO_LIVE_SESSION=1
IRIS_PO_MODEL=claude-fable-5
IRIS_DEV_MODEL=claude-sonnet-5
IRIS_STUDY_MODEL=claude-sonnet-5
IRIS_OPENSPEC_BIN=<path to openspec CLI>
```

CAUTION: TUYET DOI KHONG SET `ANTHROPIC_API_KEY` — no override OAuth token, chuyen sang billing per-token!

---

## Setup & Chay (Windows)

```powershell
# 1. Cai dependencies
cd C:\Users\vanha\Downloads\myiris
npm ci

# 2. Tao .env
Copy-Item .env.example .env
# Sua .env: them GEMINI_API_KEY

# 3. Verify Claude Code CLI
claude --version
claude -p "Reply with exactly: PONG" --output-format json

# 4. Chay dev mode (hot reload)
npm run dev

# 5. Hoac chay production
npm start

# 6. Neu da build roi, skip build
npm run start:prod

# 7. Build Windows package
npm run package:win
npm run dist:win
```

**Env file cho packaged Windows app**: `%USERPROFILE%\.iris\.env`

---

## Ba Agent Roles (Claude Code Agents)

### PO (Product Owner) — Stateful
- File persona: `resources/personas/iris-po.md`
- Installed to: `~/.claude/agents/iris-po.md`
- Co che: `@anthropic-ai/claude-agent-sdk` persistent session
- Nhiem vu: Grill request -> OpenSpec propose -> tao tasks.md cho DEV
- Co the hoi user mid-run qua AskUserQuestion (voice relay)
- Yeu cau: CLAUDE_CODE_OAUTH_TOKEN

### DEV (Developer) — Stateless
- File persona: `resources/personas/iris-dev.md`
- Installed to: `~/.claude/agents/iris-dev.md`
- Co che: one-shot `claude -p --resume` subprocess moi issue
- Nhiem vu: Implement tasks tu OpenSpec change, test-first, verify, archive
- KHONG hoi user mid-run — tu quyet, ghi "Decisions needed" cuoi run
- Yeu cau: Claude Code CLI (`claude --version`)

### STUDY — Stateful (tach biet khoi PO -> DEV pipeline)
- File persona: `resources/personas/iris-study.md`
- Co che: Agent SDK session trong `electron/study-session.mjs` rieng
- Nhiem vu: Ghi study notes vao `open-second-brain`, fact-check claims
- Yeu cau: CLAUDE_CODE_OAUTH_TOKEN + open-second-brain Claude Code plugin

### Cai dat agents thu cong:
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\agents"
Copy-Item resources\personas\iris-po.md "$env:USERPROFILE\.claude\agents\"
Copy-Item resources\personas\iris-dev.md "$env:USERPROFILE\.claude\agents\"
Copy-Item resources\personas\iris-study.md "$env:USERPROFILE\.claude\agents\"
```

Hoac dung nut "Install agents" trong SetupPanel UI.

---

## Pinned Identifiers (KHONG duoc thay doi)

| Thanh phan | Gia tri co dinh |
|-----------|----------------|
| Gemini Live model | models/gemini-3.1-flash-live-preview |
| Gemini voice | Zephyr |
| Gemini SDK | @google/genai ^2.10.0 |
| Audio send | 16 kHz PCM |
| Audio receive | 24 kHz PCM |
| MediaPipe | @mediapipe/tasks-vision ^0.10.35 |
| MediaPipe WASM URL | https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm |
| ONNX runtime | onnxruntime-web ^1.27.0 |
| Agent SDK | @anthropic-ai/claude-agent-sdk ^0.3.210 |
| Privacy Cam FPS | 15 (throttled, khong duoc tang len 60 — tieu ton GPU) |
| Privacy Cam resolution | 640x480 (khong duoc tang — 1280x720 tieu ton 4x bandwidth) |

WARNING: MediaPipe WASM URL version phai khop chinh xac voi npm package version!

---

## Glass HUD Mode

- Float over toan desktop nhu transparent overlay
- Chi cac "islands" (task cards, toggles, orb) moi nhan click — phan con lai xuyen qua
- 3 cach toggle: icon PiP tren top bar | Alt+Space (global hotkey) | Tray icon
- App luon boot vao deck mode (khong bao gio boot thang vao HUD — lockout risk)

---

## Wake Word "Hey Iris"

- On-device ONNX, chi listen khi dang sleep
- Models tai: `public/wakeword/` (melspectrogram.onnx, embedding_model.onnx, hey_iris.onnx)
- WASM: onnxruntime-web@1.27.0 tu jsDelivr CDN
- Tat: IRIS_WAKE_WORD=0 hoac toggle trong Settings

---

## Live Screen Vision

- Hotkey: `Super+Shift+V` (global, bat/tat)
- Khi bat: WebRTC stream man hinh chinh -> Gemini nhin thay realtime
- **Tối ưu (Hash skip)**: Ảnh buffer JPEG được băm SHA-1. Nếu mã băm giống frame trước (màn hình tĩnh), hệ thống bỏ qua không gửi để tiết kiệm băng thông và token.
- Component `CenterStage.tsx` hien thi icon sang khi dang active
- Gemini cung co the tu goi `toggle_screen_vision` tool khi user noi "hay nhin man hinh cua toi"

---

## Ollama Local AI

- Hotkey: `Super+Shift+L` (chuyen qua local mode)
- Khi bat: Gemini forward user query qua tool `submit_local_chat` -> `electron/memory-session.mjs` -> Ollama API (localhost:11434)
- SYSTEM_EVENT_LOCALCHAT_TOGGLE: true/false thong bao cho Gemini dang o mode nao
- Yeu cau: Ollama chay local (https://ollama.ai)

---

## ChromaDB Second Brain

- Module: `electron/memory-session.mjs`
- Tools: `save_to_memory` (Iris ghi nho), `query_memory` (Iris truy van)
- User noi "Iris, nho cai nay" -> Gemini goi `save_to_memory`
- User hoi ve qua khu -> Gemini goi `query_memory` truoc khi tra loi

---

## Privacy Cam

- File: `resources/privacy-cam.html`
- Chay trong BrowserWindow an (invisible window)
- MediaPipe FaceLandmarker (GPU delegate) -> phat hien khuon mat -> ve blur tren canvas
- Thong so bao mat GPU: **15fps** (throttled), **640x480** (giam tu 1280x720), **numFaces: 2**
- Khong co IPC ra ben ngoai — hoan toan isolated

---

## Companion Camera (iPhone WebRTC)

- **Mục đích**: Dùng điện thoại làm camera và microphone rời cho Iris.
- **Cơ chế**: Chạy app `iris-companion` (Expo) thông qua ngrok tunnel.
- **Cách kết nối**: App sinh mã QR chứa URL ngrok thực tế (thay vì LAN IP để vượt tường lửa). Người dùng quét mã bằng Expo Go.
- **IPC Handler**: `companion:start-expo` (khởi chạy process ngrok) và `companion:get-tunnel-url` (polling lấy link thật).
- **Bảo mật (CSPRNG)**: Sử dụng `crypto.randomBytes(32).toString('hex')` thay vì `Math.random()` để sinh session token, đảm bảo an toàn tuyệt đối qua ngrok public internet.
- **Bảo mật (ROOM_TOKEN)**: Server signaling riêng (`PHONE_CAMERA/server.js` cổng 8443) bắt buộc kiểm tra `ROOM_TOKEN` trong message `join` để ngăn chặn truy cập trái phép xem luồng camera. Cổng 8080 local cho OBS được giữ nguyên không cần token vì đã có ranh giới local.

---

## Robot Cameras (PiP / Điều khiển) & Smart Home

- **Giao diện**: Hiển thị dưới dạng cửa sổ trôi (Picture-in-Picture) có thể kéo thả (`DraggablePiP`), hạ z-index (500) khi thu nhỏ để không vướng UI khác.
- **Config**: Đọc cấu hình từ `robots.json` (tự động xử lý an toàn nếu file rỗng hoặc không tồn tại).
- **Tránh cache & chống lag**: URL stream camera sử dụng `?ts=Date.now()` để ép trình duyệt tải mới, refresh mỗi 3s. Tự động phục hồi khi URL sống lại.
- **Điều khiển**: Có Gemini tool `trigger_robot_action` gửi tín hiệu HTTP tới `control_url` của robot, hoặc chạy Mock mode nếu chưa config.
- **Smart Home Matching**: Khớp lệnh thoại thiết bị bằng Exact match (id, name) hoặc Token-based match (toàn bộ từ khóa). Trả về lỗi `ambiguous` nếu khớp nhiều thiết bị, TUYỆT ĐỐI KHÔNG dùng substring match để tránh gọi nhầm thiết bị.
- **Bảo mật & Firmware (ESP32)**: Endpoint `/control` trên robot yêu cầu xác thực bằng header `Authorization: Bearer <token>`. Firmware tự kiểm tra `MAX_BODY_SIZE` tại header, dùng `reserve()` cấp phát bộ nhớ liền khối chống tràn RAM (heap fragmentation), và luôn kẹp cứng góc servo (0-180) ở tầng vi điều khiển.
- **Cánh tay 4 khớp (Arm)**: Cánh tay đầy đủ 4 servo (Base, Shoulder, Elbow, Gripper) đã được tách sang một board ESP32 riêng (cấu hình `myiris_arm.yaml`) do mạch ESP32-CAM không đủ GPIO an toàn. Khai báo cánh tay mới trong `robots.json` với IP và token độc lập.

---

## Claude Task Flow

```
User noi: "hay build feature X"
  -> Gemini Live nhan giong
  -> Gemini call submit_claude_task({role: "po", task: "build feature X"})
  -> electron/main.mjs -> dispatch theo role:
      DEV: spawn claude -p "..." --output-format stream-json --verbose --permission-mode bypassPermissions --resume <session_id>
      PO:  deliverPoTurn() -> po-session.mjs Agent SDK session
  -> NDJSON stream -> Work Stream panel (realtime tool calls)
  -> Khi xong: SYSTEM_EVENT_CLAUDE_COMPLETE -> Gemini doc ket qua to
```

**Claude session persistence**: `~/.iris/claude-sessions.json`
**Working directory**: `~/.iris/workspace` (override: IRIS_CLAUDE_CWD)

---

## OpenSpec (SDD Surface)

Toan bo spec song tai `openspec/specs/`. Moi thay doi behavior deu qua:
1. PO: openspec-propose -> tao `openspec/changes/<name>/` (proposal, design, specs, tasks.md)
2. DEV: implement tasks (openspec-apply-change / /opsx:apply)
3. Archive: openspec-archive-change -> sync vao `openspec/specs/`

---

## npm Scripts

| Script | Mo ta |
|--------|-------|
| npm ci | Install tu package-lock.json (clean install) |
| npm run dev | Dev mode voi hot reload (Vite + Electron) |
| npm run build | TypeCheck + build vao dist/ |
| npm start | Build + launch production |
| npm run start:prod | Launch production (da build) |
| npm run package:win | Dong goi Windows (thu muc) |
| npm run dist:win | Distributable Windows build |

---

## Common Issues & Fixes

### Claude CLI khong tim thay tren Windows
```powershell
# Them vao .env:
IRIS_CLAUDE_BIN=C:\Users\vanha\AppData\Local\Programs\claude\claude.exe
```

### PO/STUDY fail voi auth error
- Chay: claude setup-token
- Set CLAUDE_CODE_OAUTH_TOKEN trong .env
- KHONG set ANTHROPIC_API_KEY

### Gemini Live session khong mo duoc
- Model name phai la: models/gemini-3.1-flash-live-preview (co prefix models/)
- Kiem tra GEMINI_API_KEY trong .env

### MediaPipe gesture khong hoat dong
- Can internet lan dau (WASM + model tai tu CDN)
- Kiem tra version: npm @mediapipe/tasks-vision phai khop voi WASM_URL version

### Privacy Cam tieu ton GPU nhieu
- Kiem tra: target FPS phai la 15, resolution phai la 640x480, numFaces phai la 2
- KHONG thay doi cac gia tri nay truoc khi profiling

### open_url_or_app khong mo duoc app mong muon
- Them ten .exe vao `ALLOWED_APP_EXECUTABLES` trong `electron/main.mjs`
- Chi dung basename (vd: "chrome.exe"), khong dung duong dan day du

### Rollback PO ve stateless (neu Agent SDK loi)
```
IRIS_PO_LIVE_SESSION=0
```

---

## Tham khao them

- README.md — Tai lieu day du
- CLAUDE.md — Huong dan cho Claude Code
- ARCHITECTURE_PLAN.md — Ke hoach J.A.R.V.I.S Upgrade
- .env.example — Template env vars
- electron/main.mjs — Core logic (~5100 lines, cap nhat 2026-08-02)
- src/App.tsx — Renderer (~1870 lines, cap nhat 2026-08-02)

---

## Lien he tac gia

- Website: https://www.mrqhocungdungai.io.vn
- Buy me a coffee: https://buymeacoffee.com/mrqhocungdungai
- TikTok: @mr.q.hoc.ung.dung.ai
