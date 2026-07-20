---
name: myiris
description: >
  Kien thuc day du ve du an myiris (Iris) — mot AI voice companion
  de dieu khien may tinh bang giong noi, ra lenh cho Claude Code lam viec
  ngam, dieu khien tay bang camera, va quan ly workstream phat trien phan mem.
  Kich hoat skill nay khi nguoi dung hoi ve myiris, Iris, cach cai dat/chay/
  cau hinh/sua/mo rong du an tai C:\Users\vanha\Downloads\myiris.
---

# Skill: myiris (Iris Voice AI Companion)

## Tong quan du an

**Iris** la mot desktop voice companion dang Electron + React + TypeScript + Vite.

- **Tac gia ban fork**: MRQ Hoc Ung Dung AI (fork tu ASHR12/iris)
- **Duong dan tren may**: `C:\Users\vanha\Downloads\myiris`
- **License**: MIT
- **Tested on**: macOS M4 (chay duoc ca Windows/Linux)
- **Chay tren Windows**: Fully supported

### Iris lam duoc gi?

1. **Dieu khien may tinh bang giong noi** — noi voi Iris, Iris nghe realtime qua Gemini Live
2. **Giao viec cho Claude Code** — Gemini route cong viec phuc tap sang Claude headless (`claude -p`)
3. **Dieu khien tay bang camera** — dung MediaPipe GestureRecognizer (on-device, webcam)
4. **Glass HUD overlay** — float over toan man hinh nhu overlay trong suot
5. **Wake word "Hey Iris"** — ONNX on-device wake word detection
6. **Pipeline phat trien PO -> DEV** — Iris la voice-controlled software development pipeline

---

## Kien truc tong the

```
User noi -> Electron Renderer (WebRTC AEC mic)
         -> Electron Main -> Gemini Live API (models/gemini-3.1-flash-live-preview)
         -> Gemini quyet dinh route:
              |-- Google Search (cau hoi nhanh, fact)
              |-- submit_claude_task -> Claude Code headless (claude -p)
                                     -> NDJSON stream -> Work Stream panel
                                     -> SYSTEM_EVENT_CLAUDE_COMPLETE -> Gemini thong bao
```

---

## Cau truc thu muc

```
myiris/
|-- electron/
|   |-- main.mjs          # TRUNG TAM: Gemini Live session, Claude bridge, HUD, Tray (~1500 lines)
|   |-- preload.cjs       # IPC bridge -> window.iris (audio, sidecar events, session controls)
|   |-- po-session.mjs    # Module PO: Agent SDK stateful session (persistent)
|   |-- study-session.mjs # Module STUDY: Agent SDK stateful session (isolated)
|   |-- run-queue.mjs     # Hang doi chay tung task mot (PO + DEV share same slot)
|   |-- claude-stream.mjs # Parse NDJSON stream tu claude -p
|-- src/
|   |-- App.tsx            # Renderer chinh (~1350 lines): mic capture, audio playback, UI
|   |-- components/
|   |   |-- HudShell.tsx   # Glass HUD overlay
|   |   |-- ReactorCore.tsx# Orb animation (Three.js)
|   |   |-- WorkStream.tsx # Panel hien thi Claude tasks
|   |   |-- SetupPanel.tsx # UI setup/config
|   |   |-- ...
|   |-- hooks/
|   |   |-- useHandControl.ts  # MediaPipe GestureRecognizer hook
|   |   |-- useWakeWord.ts     # ONNX wake word detection
|   |   |-- useAudioPipeline.ts# WebRTC mic -> 16kHz PCM
|   |   |-- useHandoffFx.ts    # Handoff animation
|   |-- types.ts
|-- resources/personas/
|   |-- iris-po.md    # Claude agent: Product Owner (grill + OpenSpec propose)
|   |-- iris-dev.md   # Claude agent: Developer (headless implement + verify)
|   |-- iris-study.md # Claude agent: Study (second-brain note taker)
|-- openspec/         # Living spec (SDD surface)
|-- wakeword-models/  # ONNX models: melspectrogram, embedding, hey_iris
|-- public/wakeword/  # Bundled wakeword models
|-- .env.example      # Template env vars
|-- CLAUDE.md         # Huong dan cho Claude Code khi lam viec voi repo nay
|-- README.md         # Tai lieu day du
|-- plan.md           # Ke hoach kien truc
```

---

## Cac file quan trong nhat

### `electron/main.mjs` (~1500 dong)
Day la trai tim cua toan bo he thong:
- Tao Gemini Live session (`@google/genai`)
- Khai bao 7 Gemini tools: `check_claude_status`, `submit_claude_task`, `get_claude_task_status`, `stop_claude_task`, `start_new_claude_session`, `get_workspace_info`, `answer_po_question`
- Bridge Gemini tool calls -> headless Claude (`claude -p ... --output-format stream-json --verbose --permission-mode bypassPermissions`)
- Glass HUD: `enterHud()`, `exitHud()`, `toggleHud()` — mot BrowserWindow swap giua deck va transparent click-through fullscreen overlay
- Tray icon + global hotkey (`Alt+Space` default)
- Quan ly Claude sessions (persist tai `~/.iris/claude-sessions.json`)

### `electron/po-session.mjs`
Module PO stateful:
- Agent SDK session (`@anthropic-ai/claude-agent-sdk`) persistent
- `AskUserQuestion` — pause mid-turn, hoi user qua voice, tiep tuc sau khi co cau tra loi
- Authenticate via `CLAUDE_CODE_OAUTH_TOKEN` (KHONG phai `ANTHROPIC_API_KEY`)
- `computePoSessionEnv()` — strip `ANTHROPIC_API_KEY` de khong override OAuth token

### `src/hooks/useHandControl.ts`
MediaPipe gesture hook:
- `Pointing_Up` -> move cursor, dwell 850ms -> open task card
- `Open_Palm` -> hold-to-scroll reader
- `Closed_Fist` -> close reader
- GPU delegate, 640x480, exponential smoothing (0.5), 3-frame stabilization

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

## Dieu khien ban phim

| Phim | Chuc nang |
|------|-----------|
| W    | Wake — khoi dong Gemini Live + mic + camera |
| S    | Sleep — dung moi thu |
| Alt+Space | Toggle Glass HUD (override bang IRIS_HUD_HOTKEY) |

---

## Dieu khien tay (khi camera enabled)

| Cu chi | Hanh dong |
|--------|-----------|
| Pointing Up (ngon tro len) | Di chuyen cursor; dwell ~850ms -> mo task card |
| Open Palm (mo ban tay) | Hold-to-scroll (cao = len, thap = xuong) |
| Closed Fist (nam tay) | Dong reader |

Camera tu dong bat sau khi Wake (W). Co the toggle thu cong bang icon tay tren goc phai.

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

### Rollback PO ve stateless (neu Agent SDK loi)
```
IRIS_PO_LIVE_SESSION=0
```

---

## Tham khao them

- README.md — Tai lieu day du
- CLAUDE.md — Huong dan cho Claude Code
- .env.example — Template env vars
- electron/main.mjs — Core logic (~1500 lines)
- src/App.tsx — Renderer (~1350 lines)

---

## Lien he tac gia

- Website: https://www.mrqhocungdungai.io.vn
- Buy me a coffee: https://buymeacoffee.com/mrqhocungdungai
- TikTok: @mr.q.hoc.ung.dung.ai
