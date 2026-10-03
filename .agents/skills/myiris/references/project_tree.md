# Sơ đồ cấu trúc file (Project Tree)

> Cập nhật lần cuối: 2026-08-02 (trước đó bị lỗi thời — thiếu hơn chục file/module đã thêm vào `electron/` như `renderer-security.mjs`, `action-lane.mjs`, `vault-graph*.mjs`, v.v. và vẫn còn liệt kê các file rác đã bị xoá). Các thư mục lớn/vendored (`reponew/`, `openspec/changes/archive/*`) được rút gọn còn 1-2 cấp để bản đồ dễ đọc — xem trực tiếp trong repo nếu cần chi tiết. Không có `node_modules/`, `dist/`, `.git/`, `meeting_recordings/`, `media/` (đều bị `.gitignore` hoặc quá nặng để liệt kê).

```text
irit/
├── .agents/
│   ├── skills/
│   │   ├── myiris/
│   │   │   ├── references/
│   │   │   │   └── project_tree.md
│   │   │   └── SKILL.md
│   │   └── setup-mkcert/
│   │       └── SKILL.md
│   ├── skills.json
│   └── SKILLS_MAP.md
├── build/
│   ├── icon.png
│   ├── trayTemplate.png
│   └── trayTemplate@2x.png
├── electron/
│   ├── capabilities/
│   │   ├── canvas.mjs
│   │   └── second-brain.mjs
│   ├── action-lane.mjs
│   ├── atomic-file.mjs
│   ├── browser-agent.mjs
│   ├── canvas-mcp.mjs
│   ├── canvas-store.mjs
│   ├── claude-stream.mjs
│   ├── companion-server.mjs
│   ├── companion.html
│   ├── computer-session.mjs
│   ├── main.mjs
│   ├── memory-session.mjs
│   ├── po-session.mjs
│   ├── preload.cjs
│   ├── renderer-security.mjs
│   ├── run-queue.mjs
│   ├── smarthome-rules.mjs
│   ├── study-session.mjs
│   ├── task-review.mjs
│   ├── telegram-bot.mjs
│   ├── vault-graph-parse.mjs
│   └── vault-graph.mjs
├── iris-companion/
│   ├── assets/
│   │   ├── android-icon-background.png
│   │   ├── android-icon-foreground.png
│   │   ├── android-icon-monochrome.png
│   │   ├── favicon.png
│   │   ├── icon.png
│   │   └── splash-icon.png
│   ├── .gitignore
│   ├── AGENTS.md
│   ├── App.js
│   ├── app.json
│   ├── CLAUDE.md
│   ├── index.js
│   ├── LICENSE
│   ├── package-lock.json
│   └── package.json
├── openspec/
│   ├── changes/
│   │   └── archive/
│   │       ├── 2026-07-16-architecture-deepening-refactors/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-16-per-role-model-selection/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-16-po-live-session/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-17-deepen-run-executor/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-17-two-hand-gestures-and-orb/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-18-glass-hud-overlay/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-18-po-voice-controller/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-18-ui-deepspace-restructure/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-18-voice-ui-and-setup/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-19-camera-device-selection/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-19-context-supplement-composer/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       ├── 2026-07-19-jarvis-deck-visuals/
│   │       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │       └── 2026-07-19-study-note-role/
│   │           └── ... (da rut gon o day, xem truc tiep trong repo)
│   ├── specs/
│   │   ├── agent-subscription-auth/
│   │   │   └── spec.md
│   │   ├── context-supplement-composer/
│   │   │   └── spec.md
│   │   ├── deepspace-skin/
│   │   │   └── spec.md
│   │   ├── glass-hud-mode/
│   │   │   └── spec.md
│   │   ├── global-agent-runtime/
│   │   │   └── spec.md
│   │   ├── holo-deck-backdrop/
│   │   │   └── spec.md
│   │   ├── hud-activation/
│   │   │   └── spec.md
│   │   ├── openspec-native-pipeline/
│   │   │   └── spec.md
│   │   ├── orb-expressions/
│   │   │   └── spec.md
│   │   ├── per-role-model-selection/
│   │   │   └── spec.md
│   │   ├── po-live-session/
│   │   │   └── spec.md
│   │   ├── renderer-structure/
│   │   │   └── spec.md
│   │   ├── run-execution-queue/
│   │   │   └── spec.md
│   │   ├── session-announcements/
│   │   │   └── spec.md
│   │   ├── setup-panel/
│   │   │   └── spec.md
│   │   ├── study-note-role/
│   │   │   └── spec.md
│   │   ├── task-step-timeline/
│   │   │   └── spec.md
│   │   ├── two-hand-gestures/
│   │   │   └── spec.md
│   │   ├── voice-decision-relay/
│   │   │   └── spec.md
│   │   ├── voice-ui-control/
│   │   │   └── spec.md
│   │   ├── wake-sleep-voice/
│   │   │   └── spec.md
│   │   └── workstream-switcher/
│   │       └── spec.md
│   └── config.yaml
├── PHONE_CAMERA/
│   ├── public/
│   │   ├── phone.html
│   │   ├── source.html
│   │   └── viewer.html
│   ├── .gitignore
│   ├── .url
│   ├── LICENSE
│   ├── package-lock.json
│   ├── package.json
│   ├── README.md
│   ├── server.js
│   └── setup.ps1
├── public/
│   └── wakeword/
│       ├── embedding_model.onnx
│       ├── hey_iris.onnx
│       └── melspectrogram.onnx
├── reponew/
│   ├── esphome/
│   │   ├── docker/
│   │   │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │   ├── esphome/
│   │   │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │   ├── script/
│   │   │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │   ├── tests/
│   │   │   └── ... (da rut gon o day, xem truc tiep trong repo)
│   │   ├── .clang-format
│   │   ├── .clang-tidy
│   │   ├── .coveragerc
│   │   ├── .dockerignore
│   │   ├── .editorconfig
│   │   ├── .flake8
│   │   ├── .gitattributes
│   │   ├── .gitignore
│   │   ├── .pre-commit-config.yaml
│   │   ├── .yamllint
│   │   ├── AGENTS.md
│   │   ├── CLAUDE.md
│   │   ├── CODE_OF_CONDUCT.md
│   │   ├── codecov.yml
│   │   ├── CODEOWNERS
│   │   ├── CONTRIBUTING.md
│   │   ├── Doxyfile
│   │   ├── GEMINI.md
│   │   ├── LICENSE
│   │   ├── MANIFEST.in
│   │   ├── myiris_arm.yaml
│   │   ├── myiris_arm_control.h
│   │   ├── myiris_control.h
│   │   ├── myiris_robot.yaml
│   │   ├── netlify.toml
│   │   ├── platformio.ini
│   │   └── ... (con nhieu file/thu muc khac, da rut gon)
│   └── toado/
│       ├── docs/
│       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│       ├── imgs/
│       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│       ├── omnitool/
│       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│       ├── util/
│       │   └── ... (da rut gon o day, xem truc tiep trong repo)
│       ├── .gitignore
│       ├── api_server.py
│       ├── demo.ipynb
│       ├── gradio_demo.py
│       ├── LICENSE
│       ├── README.md
│       ├── requirements.txt
│       └── SECURITY.md
├── resources/
│   ├── personas/
│   │   ├── iris-dev.md
│   │   ├── iris-po.md
│   │   └── iris-study.md
│   ├── skills/
│   │   └── claude-skills/
│   │       ├── code-review/
│   │       │   ├── agents/
│   │       │   │   └── openai.yaml
│   │       │   └── SKILL.md
│   │       ├── diagnosing-bugs/
│   │       │   ├── agents/
│   │       │   │   └── openai.yaml
│   │       │   ├── scripts/
│   │       │   │   └── hitl-loop.template.sh
│   │       │   └── SKILL.md
│   │       ├── grilling/
│   │       │   ├── agents/
│   │       │   │   └── openai.yaml
│   │       │   └── SKILL.md
│   │       ├── openspec-apply-change/
│   │       │   └── SKILL.md
│   │       ├── openspec-archive-change/
│   │       │   └── SKILL.md
│   │       ├── openspec-explore/
│   │       │   └── SKILL.md
│   │       ├── openspec-propose/
│   │       │   └── SKILL.md
│   │       ├── openspec-sync-specs/
│   │       │   └── SKILL.md
│   │       ├── openspec-update-change/
│   │       │   └── SKILL.md
│   │       ├── tdd/
│   │       │   ├── agents/
│   │       │   │   └── openai.yaml
│   │       │   ├── mocking.md
│   │       │   ├── SKILL.md
│   │       │   └── tests.md
│   │       ├── wiki-config/
│   │       │   ├── assets/
│   │       │   │   ├── templates/
│   │       │   │   │   ├── config.md
│   │       │   │   │   ├── domain-home.md
│   │       │   │   │   ├── established-patterns.md
│   │       │   │   │   ├── home.md
│   │       │   │   │   ├── index.md
│   │       │   │   │   ├── knowledge.md
│   │       │   │   │   ├── log.md
│   │       │   │   │   ├── longform.md
│   │       │   │   │   ├── note.md
│   │       │   │   │   ├── overview.md
│   │       │   │   │   ├── profile.md
│   │       │   │   │   ├── reference.md
│   │       │   │   │   └── survey.md
│   │       │   │   ├── wiki-config-template.md
│   │       │   │   ├── wiki-help.md
│   │       │   │   └── wiki-schema.md
│   │       │   ├── references/
│   │       │   │   └── setup-help.md
│   │       │   └── SKILL.md
│   │       ├── wiki-crystallize/
│   │       │   ├── references/
│   │       │   │   ├── setup-help.md
│   │       │   │   ├── wiki-config-template.md
│   │       │   │   └── wiki-schema.md
│   │       │   └── SKILL.md
│   │       ├── wiki-ingest/
│   │       │   ├── references/
│   │       │   │   ├── setup-help.md
│   │       │   │   ├── wiki-config-template.md
│   │       │   │   └── wiki-schema.md
│   │       │   └── SKILL.md
│   │       ├── wiki-integrate/
│   │       │   ├── references/
│   │       │   │   ├── setup-help.md
│   │       │   │   ├── wiki-config-template.md
│   │       │   │   └── wiki-schema.md
│   │       │   └── SKILL.md
│   │       ├── wiki-lint/
│   │       │   ├── references/
│   │       │   │   ├── setup-help.md
│   │       │   │   ├── wiki-config-template.md
│   │       │   │   └── wiki-schema.md
│   │       │   └── SKILL.md
│   │       ├── wiki-query/
│   │       │   ├── references/
│   │       │   │   ├── setup-help.md
│   │       │   │   ├── wiki-config-template.md
│   │       │   │   └── wiki-schema.md
│   │       │   └── SKILL.md
│   │       ├── LICENSE-mattpocock-skills
│   │       ├── LICENSE-openspec
│   │       └── LICENSE-vanillaflava-llm-wiki-skills
│   └── privacy-cam.html
├── scripts/
│   ├── kill-old-ngrok.mjs
│   ├── python-command.mjs
│   ├── render-icon.mjs
│   └── run-electron.mjs
├── setuprobot/
│   ├── arduino_usb/
│   │   ├── arduino_usb.ino
│   │   └── usb_server.py
│   ├── esp32_cam_iris/
│   │   ├── app_httpd.cpp
│   │   └── esp32_cam_iris.ino
│   ├── esp32_robot/
│   │   └── esp32_robot.ino
│   ├── HUONG_DAN_CHI_TIET.md
│   ├── README.md
│   └── ROBOTIC_ARM_GUIDE.md
├── setupsmarthome/
│   ├── esp32_relay/
│   │   └── esp32_relay.ino
│   ├── usb_relay/
│   │   └── usb_server.py
│   ├── HUONG_DAN_SMARTHOME.md
│   ├── myiris_smarthome.yaml
│   ├── myiris_smarthome_camera.yaml
│   ├── smarthome_control.h
│   └── wokwi_bridge.js
├── sidecar/
│   ├── __init__.py
│   ├── hermes_client.py
│   ├── hermes_process.py
│   ├── live_transcriber.py
│   ├── meeting_recorder.py
│   ├── mouse_controller.py
│   ├── protocol.py
│   ├── requirements.txt
│   └── voice_server.py
├── src/
│   ├── components/
│   │   ├── ActionLanes.tsx
│   │   ├── BootSequence.tsx
│   │   ├── CameraDock.tsx
│   │   ├── CenterStage.tsx
│   │   ├── CommsPanel.tsx
│   │   ├── CompanionLiveView.tsx
│   │   ├── CompanionQR.tsx
│   │   ├── CompanionVideo.tsx
│   │   ├── CompanionWebRTC.tsx
│   │   ├── ConfirmModal.tsx
│   │   ├── ContextSupplementInput.tsx
│   │   ├── DraggablePiP.tsx
│   │   ├── DrawingCanvas.tsx
│   │   ├── HandoffLayer.tsx
│   │   ├── HandReticles.tsx
│   │   ├── HistoryDrawer.tsx
│   │   ├── HoloBackdrop.tsx
│   │   ├── HudShell.tsx
│   │   ├── NoteReader.tsx
│   │   ├── PipelineBar.tsx
│   │   ├── PoQuestionBanner.tsx
│   │   ├── ProjectBar.tsx
│   │   ├── ReactorCore.tsx
│   │   ├── ReaderCore.tsx
│   │   ├── ReaderOverlay.tsx
│   │   ├── ReviewBanner.tsx
│   │   ├── RobotCameras.tsx
│   │   ├── SessionSwitcher.tsx
│   │   ├── SetupPanel.tsx
│   │   ├── SmartHomeCameras.tsx
│   │   └── ... (con nhieu file/thu muc khac, da rut gon)
│   ├── hooks/
│   │   ├── useAudioPipeline.ts
│   │   ├── useHandControl.ts
│   │   ├── useHandoffFx.ts
│   │   └── useWakeWord.ts
│   ├── lib/
│   │   ├── agents.ts
│   │   ├── companionStream.ts
│   │   ├── galaxy-nav.ts
│   │   ├── sounds.ts
│   │   └── tasks.ts
│   ├── styles/
│   │   ├── base.css
│   │   ├── claude.css
│   │   ├── deck.css
│   │   ├── fx.css
│   │   ├── holo.css
│   │   ├── hud.css
│   │   ├── index.css
│   │   ├── overlays.css
│   │   ├── reactor.css
│   │   └── tokens.css
│   ├── App.tsx
│   ├── main.tsx
│   ├── types.ts
│   └── vite-env.d.ts
├── wakeword-models/
│   ├── hey_iris-full-10k/
│   │   ├── hey_iris_full.onnx
│   │   ├── hey_iris_full.pt
│   │   ├── hey_iris_full_eval.json
│   │   ├── hey_iris_full_metrics.json
│   │   └── README.txt
│   └── hey_iris-quick-4k/
│       ├── hey_iris.onnx
│       ├── hey_iris.pt
│       ├── hey_iris_eval.json
│       ├── hey_iris_metrics.json
│       └── README.txt
├── .env.example
├── .gitignore
├── ARCHITECTURE_PLAN.md
├── Bao-Cao-Kiem-Thu-QA-Report-2026-07-21.md
├── CHANGES.md
├── CLAUDE.md
├── HUONG_DAN_KET_NOI.md
├── index.html
├── LICENSE
├── meeting_record.wav
├── mkcert.exe
├── NANG_CAP_MOI.md
├── output_toado.png
├── package-lock.json
├── package.json
└── ... (con nhieu file/thu muc khac, da rut gon)
```
