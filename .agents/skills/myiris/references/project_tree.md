# Sơ đồ cấu trúc file (Project Tree)

```text
myiris/
├── .env
├── .env.example
├── .gitignore
├── ARCHITECTURE_PLAN.md
├── CLAUDE.md
├── HUONG_DAN_KET_NOI.md
├── LICENSE
├── PHONE_CAMERA
│   ├── .gitignore
│   ├── LICENSE
│   ├── README.md
│   ├── package-lock.json
│   ├── package.json
│   ├── public
│   │   ├── phone.html
│   │   ├── source.html
│   │   └── viewer.html
│   ├── server.js
│   └── setup.ps1
├── README.md
├── báo cáo camera,ROBOT,APP.md
├── electron
│   ├── claude-stream.mjs
│   ├── companion-server.mjs
│   ├── companion.html
│   ├── computer-session.mjs
│   ├── main.mjs
│   ├── memory-session.mjs
│   ├── po-session.mjs
│   ├── preload.cjs
│   ├── run-queue.mjs
│   ├── study-session.mjs
│   └── telegram-bot.mjs
├── gen_tree.py
├── index.html
├── iris-companion
│   ├── .claude
│   │   └── settings.json
│   ├── .expo
│   │   ├── README.md
│   │   ├── dev
│   │   │   └── logs
│   │   │       └── start.log
│   │   ├── devices.json
│   │   ├── settings.json
│   │   └── web
│   │       └── cache
│   │           └── production
│   │               └── images
│   │                   └── favicon
│   │                       └── favicon-a4e030697a7571b3e95d31860e4da55d2f98e5e861e2b55e414f45a8556828ba-contain-transparent
│   │                           └── favicon-48.png
│   ├── .gitignore
│   ├── AGENTS.md
│   ├── App.js
│   ├── CLAUDE.md
│   ├── LICENSE
│   ├── app.json
│   ├── assets
│   │   ├── android-icon-background.png
│   │   ├── android-icon-foreground.png
│   │   ├── android-icon-monochrome.png
│   │   ├── favicon.png
│   │   ├── icon.png
│   │   └── splash-icon.png
│   ├── index.js
│   ├── package-lock.json
│   └── package.json
├── media
│   ├── deck.png
│   ├── demo.mp4
│   ├── hud-reader.png
│   └── hud.png
├── meeting_record.wav
├── meeting_recordings
│   └── 2026-07-22
│       ├── meeting_10-02-15.wav
│       └── meeting_10-30-02.wav
├── openspec
│   ├── changes
│   │   └── archive
│   │       ├── 2026-07-16-architecture-deepening-refactors
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   └── session-announcements
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-16-per-role-model-selection
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   └── per-role-model-selection
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-16-po-live-session
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   ├── agent-subscription-auth
│   │       │   │   │   └── spec.md
│   │       │   │   ├── po-live-session
│   │       │   │   │   └── spec.md
│   │       │   │   └── voice-decision-relay
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-17-deepen-run-executor
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   └── run-execution-queue
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-17-two-hand-gestures-and-orb
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   ├── orb-expressions
│   │       │   │   │   └── spec.md
│   │       │   │   ├── task-step-timeline
│   │       │   │   │   └── spec.md
│   │       │   │   └── two-hand-gestures
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-18-glass-hud-overlay
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   ├── glass-hud-mode
│   │       │   │   │   └── spec.md
│   │       │   │   ├── hud-activation
│   │       │   │   │   └── spec.md
│   │       │   │   └── voice-decision-relay
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-18-po-voice-controller
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   ├── global-agent-runtime
│   │       │   │   │   └── spec.md
│   │       │   │   ├── openspec-native-pipeline
│   │       │   │   │   └── spec.md
│   │       │   │   └── po-live-session
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-18-ui-deepspace-restructure
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   ├── deepspace-skin
│   │       │   │   │   └── spec.md
│   │       │   │   ├── renderer-structure
│   │       │   │   │   └── spec.md
│   │       │   │   └── workstream-switcher
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-18-voice-ui-and-setup
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   ├── setup-panel
│   │       │   │   │   └── spec.md
│   │       │   │   ├── voice-ui-control
│   │       │   │   │   └── spec.md
│   │       │   │   └── wake-sleep-voice
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-19-camera-device-selection
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   ├── setup-panel
│   │       │   │   │   └── spec.md
│   │       │   │   └── two-hand-gestures
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-19-context-supplement-composer
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   └── context-supplement-composer
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       ├── 2026-07-19-jarvis-deck-visuals
│   │       │   ├── .openspec.yaml
│   │       │   ├── design.md
│   │       │   ├── proposal.md
│   │       │   ├── specs
│   │       │   │   ├── holo-deck-backdrop
│   │       │   │   │   └── spec.md
│   │       │   │   ├── orb-expressions
│   │       │   │   │   └── spec.md
│   │       │   │   └── two-hand-gestures
│   │       │   │       └── spec.md
│   │       │   └── tasks.md
│   │       └── 2026-07-19-study-note-role
│   │           ├── .openspec.yaml
│   │           ├── design.md
│   │           ├── proposal.md
│   │           ├── specs
│   │           │   ├── agent-subscription-auth
│   │           │   │   └── spec.md
│   │           │   ├── global-agent-runtime
│   │           │   │   └── spec.md
│   │           │   ├── per-role-model-selection
│   │           │   │   └── spec.md
│   │           │   ├── session-announcements
│   │           │   │   └── spec.md
│   │           │   ├── study-note-role
│   │           │   │   └── spec.md
│   │           │   └── voice-decision-relay
│   │           │       └── spec.md
│   │           └── tasks.md
│   ├── config.yaml
│   └── specs
│       ├── agent-subscription-auth
│       │   └── spec.md
│       ├── context-supplement-composer
│       │   └── spec.md
│       ├── deepspace-skin
│       │   └── spec.md
│       ├── glass-hud-mode
│       │   └── spec.md
│       ├── global-agent-runtime
│       │   └── spec.md
│       ├── holo-deck-backdrop
│       │   └── spec.md
│       ├── hud-activation
│       │   └── spec.md
│       ├── openspec-native-pipeline
│       │   └── spec.md
│       ├── orb-expressions
│       │   └── spec.md
│       ├── per-role-model-selection
│       │   └── spec.md
│       ├── po-live-session
│       │   └── spec.md
│       ├── renderer-structure
│       │   └── spec.md
│       ├── run-execution-queue
│       │   └── spec.md
│       ├── session-announcements
│       │   └── spec.md
│       ├── setup-panel
│       │   └── spec.md
│       ├── study-note-role
│       │   └── spec.md
│       ├── task-step-timeline
│       │   └── spec.md
│       ├── two-hand-gestures
│       │   └── spec.md
│       ├── voice-decision-relay
│       │   └── spec.md
│       ├── voice-ui-control
│       │   └── spec.md
│       ├── wake-sleep-voice
│       │   └── spec.md
│       └── workstream-switcher
│           └── spec.md
├── package-lock.json
├── package.json
├── patch.cjs
├── plan.md
├── privacy-cam.html
├── public
│   └── wakeword
│       ├── embedding_model.onnx
│       ├── hey_iris.onnx
│       └── melspectrogram.onnx
├── resources
│   ├── personas
│   │   ├── iris-dev.md
│   │   ├── iris-po.md
│   │   └── iris-study.md
│   └── privacy-cam.html
├── robots.json
├── scripts
│   ├── python-command.mjs
│   ├── render-icon.mjs
│   └── run-electron.mjs
├── setuprobot
│   ├── HUONG_DAN_CHI_TIET.md
│   ├── README.md
│   ├── ROBOTIC_ARM_GUIDE.md
│   ├── arduino_usb
│   │   ├── arduino_usb.ino
│   │   └── usb_server.py
│   ├── esp32_cam_iris
│   │   ├── app_httpd.cpp
│   │   └── esp32_cam_iris.ino
│   └── esp32_robot
│       └── esp32_robot.ino
├── setupsmarthome
│   ├── HUONG_DAN_SMARTHOME.md
│   ├── esp32_relay
│   │   └── esp32_relay.ino
│   ├── myiris_smarthome.yaml
│   ├── smarthome_control.h
│   ├── usb_relay
│   │   └── usb_server.py
│   └── wokwi_bridge.js
├── sidecar
│   ├── __init__.py
│   ├── __pycache__
│   │   └── mouse_controller.cpython-311.pyc
│   ├── hermes_client.py
│   ├── hermes_process.py
│   ├── live_transcriber.py
│   ├── meeting_recorder.py
│   ├── mouse_controller.py
│   ├── protocol.py
│   ├── requirements.txt
│   └── voice_server.py
├── src
│   ├── App.tsx
│   ├── components
│   │   ├── BootSequence.tsx
│   │   ├── CameraDock.tsx
│   │   ├── CenterStage.tsx
│   │   ├── CommsPanel.tsx
│   │   ├── CompanionQR.tsx
│   │   ├── CompanionVideo.tsx
│   │   ├── CompanionWebRTC.tsx
│   │   ├── ContextSupplementInput.tsx
│   │   ├── DraggablePiP.tsx
│   │   ├── HandReticles.tsx
│   │   ├── HandoffLayer.tsx
│   │   ├── HistoryDrawer.tsx
│   │   ├── HoloBackdrop.tsx
│   │   ├── HudShell.tsx
│   │   ├── PipelineBar.tsx
│   │   ├── PoQuestionBanner.tsx
│   │   ├── ProjectBar.tsx
│   │   ├── ReactorCore.tsx
│   │   ├── ReaderOverlay.tsx
│   │   ├── RobotCameras.tsx
│   │   ├── SessionSwitcher.tsx
│   │   ├── SetupPanel.tsx
│   │   ├── TaskChooser.tsx
│   │   ├── TopBar.tsx
│   │   ├── WorkCard.tsx
│   │   └── WorkStream.tsx
│   ├── hooks
│   │   ├── useAudioPipeline.ts
│   │   ├── useHandControl.ts
│   │   ├── useHandoffFx.ts
│   │   └── useWakeWord.ts
│   ├── index.css
│   ├── lib
│   │   ├── agents.ts
│   │   ├── sounds.ts
│   │   └── tasks.ts
│   ├── main.tsx
│   ├── styles
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
│   ├── types.ts
│   └── vite-env.d.ts
├── test-syntax.mjs
├── tsconfig.json
├── vite.config.ts
├── wakeword-models
│   ├── hey_iris-full-10k
│   │   ├── README.txt
│   │   ├── hey_iris_full.onnx
│   │   ├── hey_iris_full.pt
│   │   ├── hey_iris_full_eval.json
│   │   └── hey_iris_full_metrics.json
│   └── hey_iris-quick-4k
│       ├── README.txt
│       ├── hey_iris.onnx
│       ├── hey_iris.pt
│       ├── hey_iris_eval.json
│       └── hey_iris_metrics.json
└── ytuong.md
```
