/**
 * electron/main.mjs — Electron entry point (package.json "main").
 *
 * This used to be a single 5,300-line file with ~150 functions covering
 * every domain of the app. It has been split into electron/main/*.mjs, one
 * file per concern (vision, robots/smart-home, sessions, the Claude runner,
 * the Gemini Live session, window/tray/HUD, the tool dispatcher, ...). See
 * CLAUDE.md for the module map.
 *
 * What's left here is exactly what has to stay in the entry point: process
 * bootstrap (.env loading), and the app.whenReady()/ipcMain/app.on wiring
 * that ties every domain module together. This file, electron/preload.cjs,
 * electron/renderer-security.mjs and electron/computer-session.mjs are the
 * only modules that import "electron" directly — every other split-out
 * module receives what it needs (a window instance, dialog, etc.) via an
 * import from window-manager.mjs/session-store.mjs or a constructor param,
 * the same dependency-injection pattern capabilities/canvas.mjs already
 * used before this split.
 */
import electron from "electron";
const { app, BrowserWindow, ipcMain, globalShortcut, shell } = electron;
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { repoRoot } from "./main/paths.mjs";
import { parseEnvFile } from "./main/env-config.mjs";
import { logPoBillingPathOnce } from "./main/claude-cli.mjs";

import { closeAllPoSessions } from "./po-session.mjs";
import { closeAllStudySessions } from "./study-session.mjs";
import { subscribeActionLanes } from "./action-lane.mjs";
import * as browserAgent from "./browser-agent.mjs";
import {
  getCompanionWsTunnel,
  getCompanionWsToken,
  getIceServers,
  sendSignalToPhone,
  stopCompanionServer,
  startCompanionServer,
} from "./companion-server.mjs";
import { installRendererSecurity } from "./renderer-security.mjs";
import { relaunchElevatedIfNeeded } from "./main/win-elevation.mjs";

import { emitEvent, emitToRenderer } from "./main/events.mjs";
import {
  mainWindow,
  appIcon,
  createWindow,
  toggleHud,
  uiMode,
  createTray,
  updateTrayMenu,
  hudHotkey,
  installAppMenu,
  stopHudStatsInterval,
} from "./main/window-manager.mjs";
import {
  liveSession,
  liveStatus,
  GreetGate,
  startLive,
  stopLive,
  sendAudioChunk,
  sendCommand,
  sendFrameToGemini,
  getNutJs,
} from "./main/gemini-live.mjs";
import { runQueue } from "./main/claude-runner.mjs";
import { canvasCapability, secondBrainCapability } from "./main/capabilities.mjs";
import { agentsSnapshot, installIrisAgents, installNotesSkills } from "./main/agents-install.mjs";
import { checkClaudeHealth } from "./main/claude-cli.mjs";
import {
  chooseWorkstreamCwd,
  createWorkstream,
  selectWorkstream,
  sessionsSnapshot,
  setAgentModel,
  setWorkstreamAgent,
} from "./main/session-store.mjs";
import {
  getFullConfig,
  getPromptReviewMode,
  previewVoice,
  testGeminiKey,
  writeUserConfig,
} from "./main/env-config.mjs";
import { resolvePromptReview } from "./main/task-review-flow.mjs";
import { getRobotsConfig, getSmartHomeCamerasConfig, setConfigWarningHandler } from "./main/device-config.mjs";
import { setUserDataDir } from "./main/paths.mjs";
import { openAppTarget, closeAppTarget } from "./main/app-launcher.mjs";
import { createHandGestureHandler } from "./main/hand-gestures.mjs";
import { resolveHotkeys } from "./main/hotkeys.mjs";
import { pickLanAddress } from "./main/network-utils.mjs";
import { createFileLogger, installGlobalErrorHandlers } from "./main/crash-log.mjs";
import { killTree } from "./main/process-utils.mjs";
import { stopWebServer } from "./web-server.mjs";
import { stopOmniServer, setOmniLogger } from "./main/omni-server.mjs";
import { cancelAllTimedDrives } from "./main/robot-actions.mjs";
import { triggerRobotAction } from "./main/robot-actions.mjs";
import { toggleScreenVision, handleCameraStreamFrame, handleDeskFrame, setDeskVisionState, setCameraStreamStatus } from "./main/vision.mjs";
import { startSmarthomeRuleEvaluator, stopSmarthomeRuleTimer } from "./main/smarthome-tools.mjs";
import { toggleMeetingRecording, meetingRecorder } from "./main/meeting-recording.mjs";
import {
  toggleTranslateMode,
  toggleCopilotMode,
  toggleLiveTranscriber,
  translateEnabled,
  translateTargetLang,
  copilotEnabled,
  copilotHistory,
  copilotStatus,
  liveTranscriber,
  askTeleprompter,
} from "./main/teleprompter.mjs";
import { setUiContext } from "./main/computer-use-tools.mjs";
import { notifyIris } from "./main/notify-iris.mjs";
import {
  resolvePendingPoQuestion,
  sendContextSupplement,
  sendPhoneCommand,
} from "./main/po-questions.mjs";
import { initMusicWidget, stopMusicWidget } from "./main/music-widget.mjs";
import { initReminders, disposeReminders, stopClipboardWatcher } from "./main/local-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Look for .env in several places so both the dev repo run and a packaged
// Iris.app can find credentials. First match for a given key wins.
function loadEnvFile() {
  const candidates = [
    path.join(repoRoot, ".env"),
    path.join(os.homedir(), ".iris", ".env"),
    process.resourcesPath ? path.join(process.resourcesPath, ".env") : null,
  ];
  for (const candidate of candidates) parseEnvFile(candidate);
}

loadEnvFile();
logPoBillingPathOnce();

let lastCompanionAudioAt = 0;
const handGestures = createHandGestureHandler({
  getNut: () => getNutJs(),
  getMainWindow: () => mainWindow,
  screen: electron.screen,
  toggleHud: () => { toggleHud(); updateTrayMenu(); },
  log: (message) => emitEvent({ type: "log", level: "error", message }),
});
app.setName("Iris");
// P-01/L-01: thư mục dữ liệu runtime (gói đã đóng có repoRoot chỉ-đọc) + cảnh báo cấu hình hiện lên UI.
setUserDataDir(app.getPath("userData"));
setConfigWarningHandler((message) => emitEvent({ type: "log", level: "warn", message }));
setOmniLogger((level, message) => emitEvent({ type: "log", level: level === "error" ? "error" : "info", message: `[omni] ${message}` }));

// T-01: lỗi toàn cục được ghi vào <userData>/logs/main.log (xoay vòng) và báo lên UI; lỗi lúc khởi động
// (trước khi app ready) vẫn làm app thoát — không nuốt hẳn lỗi nghiêm trọng.
installGlobalErrorHandlers({
  logger: createFileLogger(path.join(app.getPath("userData"), "logs")),
  isReady: () => app.isReady(),
  onError: (kind, msg) => {
    try { emitEvent({ type: "log", level: "error", message: `[${kind}] ${msg.split("\n")[0]}` }); } catch { /* chưa có renderer */ }
  },
});


// Voice-toggled hands-free local chat mode (Super+Shift+L). Self-contained
// to this file's IPC/hotkey wiring — no other module reads or writes it.
let localchatEnabled = false;

app.whenReady().then(() => {
  // Windows: some computer-use tools (minimize/restore/close) act on other
  // processes' windows and get silently blocked by UIPI if Iris isn't
  // elevated and the target window is. Ask for the standard UAC prompt and
  // hand off to the elevated relaunch before creating any windows.
  if (relaunchElevatedIfNeeded()) return;

  // TL-09: nạp lại nhắc việc đã lưu (còn hạn thì đặt lại timer; quá hạn > 1 giờ thì bỏ).
  try {
    const r = initReminders();
    if (r.restored || r.fired || r.dropped) console.log("[reminders]", JSON.stringify(r));
  } catch (e) {
    console.error("[reminders] không nạp được:", e.message);
  }

  if (appIcon && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(appIcon);
  }
  installAppMenu();

  // Feature: NL smart-home automation rules — evaluated on a plain timer,
  // independent of any voice conversation (see electron/smarthome-rules.mjs).
  startSmarthomeRuleEvaluator();

  // Feature: Action Lanes UI — push the live list of queued/running
  // background actions (computer-use, browser, smart-home) to the renderer
  // any time it changes, so ActionLanes.tsx can render it. Without this
  // subscription the "iris:action-lanes-change" channel that preload.cjs
  // and App.tsx already listen for would simply never fire.
  subscribeActionLanes((activeActions) => {
    emitToRenderer("iris:action-lanes-change", activeActions);
  });

  // SECURITY FIX: the previous inline handler granted mic/camera to ANY
  // webContents with no origin check, and nothing in main.mjs contained
  // navigation — a link inside untrusted vault/note content (rendered via
  // react-markdown) could top-level-navigate this window to a remote page
  // that still carries preload.cjs's privileged window.iris bridge, which
  // could then also request the mic/camera. installRendererSecurity() (see
  // electron/renderer-security.mjs) was written to close exactly this gap
  // but was never wired in — restoring that here.
  installRendererSecurity({ repoRoot });

  ipcMain.handle("sidecar:start", () => startLive());
  ipcMain.handle("sidecar:stop", () => stopLive());
  ipcMain.handle("sidecar:status", () => liveStatus);
  // S-03: logic an toàn nằm ở main/app-launcher.mjs (allowlist Desktop + http(s), không shell).
  ipcMain.handle("app:close", (_event, target) =>
    closeAppTarget(target, { desktopDir: app.getPath("desktop") }));
  ipcMain.handle("app:open", (_event, target) =>
    openAppTarget(target, {
      desktopDir: app.getPath("desktop"),
      openExternal: (u) => shell.openExternal(u),
      openPath: (p) => shell.openPath(p),
    }));
  ipcMain.handle("sidecar:command", (_event, command) => sendCommand(command));
  ipcMain.handle("robots:get", () => getRobotsConfig());
  ipcMain.handle("smarthome-cameras:get-config", () => getSmartHomeCamerasConfig());
  ipcMain.handle("robots:action", (_event, args) => triggerRobotAction(args));

  ipcMain.handle("desktop:apps", async () => {
    try {
      const desktopPath = app.getPath("desktop");
      const files = await fs.promises.readdir(desktopPath);
      const apps = files
        .filter(f => f.endsWith(".lnk") || f.endsWith(".url") || f.endsWith(".exe"))
        .map(f => ({
          name: f.replace(/\.(lnk|url|exe)$/i, ""),
          target: path.join(desktopPath, f)
        }));
      // Sort alphabetically
      return apps.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.error("Failed to read desktop apps:", e);
      return [];
    }
  });

  ipcMain.handle("network:get-ip", () => pickLanAddress(os.networkInterfaces()));

  // Tunnel ngrok của cổng 8080 (camera/âm thanh) — chỉ có khi IRIS_COMPANION_TUNNEL=1.
  // (V-20: đường Expo Go đã bị gỡ hoàn toàn.)
  ipcMain.handle("companion:get-ws-tunnel", () => getCompanionWsTunnel());
  ipcMain.handle("companion:get-ws-token", () => getCompanionWsToken());
  // S-02: ICE servers đọc từ .env (không còn credential trong mã nguồn)
  ipcMain.handle("companion:get-ice-servers", () => getIceServers());
  ipcMain.handle("companion:get-phone-cam-url", () => {
    try {
      const p = path.join(__dirname, "../PHONE_CAMERA/.url");
      return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : null;
    } catch (e) {
      return null;
    }
  });
  // WebRTC Signaling Relay (Desktop -> Phone)
  ipcMain.on("companion:webrtc-signal-to-phone", (e, signal) => sendSignalToPhone(signal));
  
  // WebRTC Media Stream Handlers (Renderer -> Gemini)
  // V-04: đã BỎ handler `companion:webrtc-frame`. Ảnh camera điện thoại chỉ tới Gemini qua
  // đường có cổng `vision:camera-stream-frame` (Direct Stream Vision).
  // Âm thanh điện thoại: mặc định KHÔNG đẩy lên Gemini (tránh trộn với mic PC trong cùng một
  // luồng). Bật bằng IRIS_COMPANION_AUDIO_TO_GEMINI=1 — khi đó mic PC bị bỏ qua lúc điện thoại
  // đang gửi tiếng (xem live:audio bên dưới).
  ipcMain.on("companion:webrtc-audio", (_e, pcm) => {
    if (String(process.env.IRIS_COMPANION_AUDIO_TO_GEMINI || "").trim() !== "1") return;
    lastCompanionAudioAt = Date.now();
    sendAudioChunk(pcm);
  });

  ipcMain.handle("sessions:get", () => sessionsSnapshot());
  ipcMain.handle("sessions:select", (_event, id) => selectWorkstream(String(id || "")));
  ipcMain.handle("sessions:new", (_event, label) => {
    const workstream = createWorkstream(label);
    return { status: "ok", session: { id: workstream.id, label: workstream.label }, ...sessionsSnapshot() };
  });
  ipcMain.handle("sessions:choose-cwd", (_event, id) => chooseWorkstreamCwd(String(id || "")));
  ipcMain.handle("agents:list", (_event, id) => agentsSnapshot(String(id || "")));
  ipcMain.handle("agents:select", (_event, payload) =>
    setWorkstreamAgent(String(payload?.workstreamId || ""), payload?.agent ?? null));
  ipcMain.handle("agents:install", () => installIrisAgents());
  ipcMain.handle("agents:set-model", (_event, payload) =>
    setAgentModel(String(payload?.workstreamId || ""), payload?.role, payload?.model));
  // Secondary answer path for the PO's pending AskUserQuestion — lets a
  // sighted user click an option directly instead of answering by voice.
  // Whichever path (this, or the Gemini answer_po_question tool) answers
  // first wins; the other becomes a no-op since the question is already resolved.
  ipcMain.handle("po:answer-question", (_event, answers) => resolvePendingPoQuestion(answers));
  ipcMain.handle("context-supplement:send", (_event, text) => sendContextSupplement(text));
  ipcMain.handle("phone-command:send", (_event, text) => sendPhoneCommand(text));
  ipcMain.handle("hud:toggle", () => {
    toggleHud();
    updateTrayMenu();
    return { mode: uiMode };
  });
  ipcMain.on("hud:interactive", (_event, on) => {
    if (mainWindow && uiMode === "hud") {
      mainWindow.setIgnoreMouseEvents(!on, { forward: true });
    }
  });
  // FEAT-TELEPROMPTER-INTERVIEW-01: 2 nút trên HUD Alt+T.
  ipcMain.handle("teleprompter:get-state", () => ({
    transcriberActive: Boolean(liveTranscriber && liveTranscriber.state !== "dead"),
    translateEnabled,
    translateTargetLang,
    copilotEnabled,
    copilotHistory: copilotEnabled ? copilotHistory : [],
    copilotStatus: copilotEnabled ? copilotStatus : "",
  }));
  ipcMain.handle("teleprompter:toggle-translate", (_event, targetLang) => toggleTranslateMode(targetLang));
  ipcMain.handle("teleprompter:toggle-copilot", () => toggleCopilotMode());
  ipcMain.handle("teleprompter:ask", (_event, question) => askTeleprompter(question));
  ipcMain.on("win:control", (_event, action) => {
    if (!mainWindow) return;
    if (action === "close") mainWindow.close();
    else if (action === "minimize") mainWindow.minimize();
  });
  ipcMain.handle("config:get", () => getFullConfig());
  ipcMain.handle("config:save", (_event, updates) => {
    try {
      return writeUserConfig(updates);
    } catch (e) {
      // S-10: giá trị không hợp lệ (vd chứa xuống dòng) => báo lỗi rõ cho UI, không ghi gì.
      return { ...getFullConfig(), saveError: e?.message || String(e) };
    }
  });
  ipcMain.handle("config:test-gemini", (_event, payload) => testGeminiKey(payload?.key));
  ipcMain.handle("config:test-claude", () => checkClaudeHealth());
  ipcMain.handle("config:preview-voice", (_event, payload) => previewVoice(payload || {}));
  // prompt-review-gate (ported from myiris): deck ReviewBanner talks to the
  // gate through these three channels only.
  ipcMain.handle("prompt:status", () => ({ reviewMode: getPromptReviewMode() }));
  ipcMain.handle("prompt:resolve-review", (_event, payload) => resolvePromptReview(payload || {}));
  ipcMain.handle("prompt:set-review-mode", (_event, payload) => {
    const enabled = Boolean(payload?.enabled);
    writeUserConfig({ IRIS_PROMPT_REVIEW_MODE: enabled ? "1" : "0" });
    return { status: "ok", reviewMode: getPromptReviewMode() };
  });

  // Ported from myiris: canvas + second-brain capabilities each expose a flat
  // { channel, kind: "handle"|"on", fn } list — register both the same way.
  for (const { channel, kind, fn } of [...canvasCapability.ipcHandlers, ...secondBrainCapability.ipcHandlers]) {
    if (kind === "handle") ipcMain.handle(channel, fn);
    else ipcMain.on(channel, fn);
  }
  ipcMain.handle("notes-skills:install", () => installNotesSkills());
  ipcMain.handle("notes-skills:status", () => secondBrainCapability.checkNotesSkillsStatus());
  ipcMain.on("iris:boot-done", () => GreetGate.fire());
  ipcMain.on("iris:ui-context", (_event, context) => {
    if (context && typeof context === "object") {
      setUiContext(context);
    }
  });
  ipcMain.on("live:audio", (_event, chunk) => {
    // Điện thoại đang là nguồn âm thanh (IRIS_COMPANION_AUDIO_TO_GEMINI=1) => bỏ mic PC để không trộn.
    if (Date.now() - lastCompanionAudioAt < 1500) return;
    sendAudioChunk(chunk);
  });

  // V-13: kiểm kiểu/kích thước, dedupe SHA-1 và loại trừ nguồn đều nằm trong vision.mjs.
  ipcMain.on("vision:desk-frame", (_event, base64DataUrl) => {
    handleDeskFrame(base64DataUrl);
  });
  ipcMain.on("vision:desk-state", (_event, payload) => {
    setDeskVisionState(payload === true || payload?.enabled === true);
  });
  ipcMain.on("vision:camera-stream-status", (_event, payload) => {
    setCameraStreamStatus(payload?.hasStream === true);
  });

  // FEAT-VIS-DIRECT-01: nhận frame JPEG/base64 mà Renderer đã tự vẽ từ
  // <canvas> (drawImage từ MediaStream Companion WebRTC hoặc camera robot)
  // — KHÔNG dùng desktopCapturer ở đây, Main chỉ chuyển tiếp thẳng vào
  // Gemini live session, giống hệt cách vision:desk-frame hoạt động.
  ipcMain.on("vision:camera-stream-frame", (_event, base64DataUrl) => {
    handleCameraStreamFrame(base64DataUrl);
  });

  // V-10: validate payload, đổi tỉ lệ -> toạ độ màn hình, cử chỉ hệ thống mặc định TẮT
  // (IRIS_HAND_SYSTEM_GESTURES=1 để bật). Logic nằm ở main/hand-gestures.mjs.
  ipcMain.on("iris:hand-gesture", (_event, gesture) => {
    handGestures.handle(gesture);
  });

  createWindow();

  // FIX-COMP-AUTOSTART: trước đây companion server (WebRTC camera/mic điện
  // thoại, cổng 8080/8444 + ngrok) CHỈ được startCompanionServer() bên trong
  // startLive() — tức là chỉ chạy sau khi người dùng bấm "Start Live
  // Session". Hệ quả: quét QR / mở link trước khi bấm Start -> chưa có
  // token -> không kết nối được gì, dù giao diện trông như "đang chờ".
  // Companion server không phụ thuộc vào Gemini Live (sendAudioChunk và
  // sendFrameToGemini đã tự kiểm tra `if (!liveSession) return;`), nên có
  // thể khởi động độc lập ngay từ đầu. startCompanionServer() tự early-return
  // nếu đã chạy rồi (`if (wss) return;`), nên lệnh gọi lại bên trong
  // startLive() vẫn giữ nguyên, vô hại — chỉ là gọi 2 lần cho chắc.
  startCompanionServer(emitEvent, sendAudioChunk, mainWindow, sendFrameToGemini);

  createTray();
  const registered = globalShortcut.register(hudHotkey(), () => {
    toggleHud();
    updateTrayMenu();
  });
  if (!registered) {
    emitEvent({ type: "log", level: "error", message: `Could not register HUD hotkey ${hudHotkey()}.` });
  }

  // G-05: phím tắt toàn cục cấu hình được qua IRIS_HOTKEYS (xem main/hotkeys.mjs). Đặt giá trị rỗng để
  // tắt một phím. Mặc định giữ nguyên như trước; Alt+<chữ> chiếm phím của mọi app khác nên nếu bị
  // xung đột hãy đổi, ví dụ IRIS_HOTKEYS={"robotPip":"CommandOrControl+Alt+R"}.
  const { hotkeys, warnings: hotkeyWarnings } = resolveHotkeys(process.env.IRIS_HOTKEYS);
  for (const w of hotkeyWarnings) emitEvent({ type: "log", level: "warn", message: `[hotkeys] ${w}` });

  const sendToRenderer = (channel) => () => {
    if (mainWindow) mainWindow.webContents.send(channel);
  };
  const hotkeyActions = {
    screenVision: { label: "Screen Vision", run: () => toggleScreenVision() },
    resetToBoot: {
      label: "Reset to boot",
      run: () => {
        if (mainWindow) {
          mainWindow.webContents.send("ui:reset-to-boot");
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    localChat: {
      label: "Localchat",
      run: () => {
        localchatEnabled = !localchatEnabled;
        emitEvent({ type: "log", level: "info", message: `Localchat mode is now ${localchatEnabled ? "ON" : "OFF"}.` });
        notifyIris([
          "SYSTEM_EVENT_LOCALCHAT_TOGGLE",
          `localchat_enabled: ${localchatEnabled}`,
          "instructions_to_iris:",
          "- If true, you are now a Voice Relay for a local AI. When the user speaks, DO NOT ANSWER their query directly. Immediately call `submit_local_chat` with their exact words.",
          "- If false, you are back to normal mode. Stop calling `submit_local_chat` and answer normally.",
        ]);
      },
    },
    deskVision: { label: "Desk Vision", run: sendToRenderer("vision:toggle-desk-continuous") },
    robotPip: { label: "Robot PiP", run: sendToRenderer("ui:toggle-robot-pip") },
    companionPip: { label: "Companion PiP", run: sendToRenderer("ui:toggle-companion-pip") },
    smartHomePip: { label: "Smart Home Cameras PiP", run: sendToRenderer("ui:toggle-smarthome-pip") },
    meetingRecorder: { label: "Meeting Recorder", run: () => toggleMeetingRecording() },
    teleprompter: { label: "Teleprompter", run: () => toggleLiveTranscriber() },
    copilot: { label: "AI Copilot", run: () => toggleCopilotMode() },
  };
  for (const [id, action] of Object.entries(hotkeyActions)) {
    const accelerator = hotkeys[id];
    if (!accelerator) continue; // bị tắt qua IRIS_HOTKEYS hoặc trùng phím
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, action.run);
    } catch (e) {
      emitEvent({ type: "log", level: "error", message: `Invalid ${action.label} hotkey ${accelerator}: ${e?.message || e}` });
      continue;
    }
    if (!ok) {
      emitEvent({ type: "log", level: "error", message: `Could not register ${action.label} hotkey ${accelerator} (đã bị ứng dụng khác/HĐH giữ?).` });
    }
  }

  for (let i = 1; i <= 9; i++) {
    globalShortcut.register(`CommandOrControl+Alt+${i}`, () => {
      if (mainWindow) {
        mainWindow.webContents.send("ui:expand-robot-pip", i);
      }
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  initMusicWidget();
});

app.on("will-quit", () => globalShortcut.unregisterAll());
// G-01: Electron KHÔNG chờ handler `before-quit` async — phần dọn dẹp sau `await` đầu tiên từng bị bỏ
// dở (sidecar, chuột, run con, session PO mồ côi). Nay: chặn quit, chạy cleanupAll() tuần tự với
// timeout 5 s mỗi bước, rồi mới app.exit(0).
let quitting = false;
function withTimeout(label, fn, ms = 5000) {
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise((resolve) => setTimeout(() => { console.warn(`[quit] bước "${label}" quá ${ms}ms — bỏ qua`); resolve(); }, ms)),
  ]).catch((e) => console.error(`[quit] bước "${label}" lỗi:`, e?.message || e));
}

async function cleanupAll() {
  await withTimeout("hud/timers", () => { stopHudStatsInterval(); stopSmarthomeRuleTimer(); });
  await withTimeout("browser", () => browserAgent.browserClose());
  await withTimeout("live+vision", () => stopLive()); // stopLive dừng cả mọi vòng vision
  await withTimeout("robot drive", () => cancelAllTimedDrives());
  await withTimeout("po/study sessions", () => { closeAllPoSessions(); closeAllStudySessions(); });
  await withTimeout("companion", () => stopCompanionServer());
  await withTimeout("web dashboard", () => stopWebServer());
  await withTimeout("omniparser", () => stopOmniServer());
  await withTimeout("music", () => stopMusicWidget());
  // meeting_recorder.py / live_transcriber.py: force-kill cả cây (đang thoát, không chờ graceful).
  await withTimeout("sidecars", () => {
    if (meetingRecorder?.proc && meetingRecorder.state !== "dead") killTree(meetingRecorder.proc);
    if (liveTranscriber?.proc && liveTranscriber.state !== "dead") killTree(liveTranscriber.proc);
  });
  await withTimeout("mouse release", () => handGestures.releaseGrabIfHeld());
  // TL-08/TL-09: dừng theo dõi clipboard (riêng tư) và các timer nhắc việc (dữ liệu đã lưu, nạp lại lần sau).
  await withTimeout("clipboard watcher", () => stopClipboardWatcher());
  await withTimeout("reminders", () => disposeReminders());
  await withTimeout("claude runs", () => {
    for (const run of runQueue.list()) if (run.child) killTree(run.child);
  });
}

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  cleanupAll()
    .catch((e) => console.error("[quit] cleanupAll failed:", e))
    .finally(() => app.exit(0));
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
