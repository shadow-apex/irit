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
import { getRobotsConfig, getSmartHomeCamerasConfig } from "./main/device-config.mjs";
import { triggerRobotAction } from "./main/robot-actions.mjs";
import { toggleScreenVision, handleCameraStreamFrame } from "./main/vision.mjs";
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

app.setName("Iris");

// Voice-toggled hands-free local chat mode (Super+Shift+L). Self-contained
// to this file's IPC/hotkey wiring — no other module reads or writes it.
let localchatEnabled = false;

app.whenReady().then(() => {
  // Windows: some computer-use tools (minimize/restore/close) act on other
  // processes' windows and get silently blocked by UIPI if Iris isn't
  // elevated and the target window is. Ask for the standard UAC prompt and
  // hand off to the elevated relaunch before creating any windows.
  if (relaunchElevatedIfNeeded()) return;

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
  ipcMain.handle("app:close", async (_event, target) => {
    try {
      let procName = target;
      if (target.includes("/") || target.includes("\\")) {
        procName = path.basename(target);
      }
      if (procName.toLowerCase().endsWith(".lnk") || procName.toLowerCase().endsWith(".url")) {
        procName = procName.replace(/\.(lnk|url)$/i, ".exe");
      } else if (!procName.toLowerCase().endsWith(".exe")) {
        procName = `${procName}.exe`;
      }
      
      const command = `taskkill /F /IM "${procName}"`;
      const { exec } = await import("node:child_process");
      await new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout);
          }
        });
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("app:open", async (_event, target) => {
    try {
      if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("vscode://")) {
        await shell.openExternal(target);
      } else {
        if (!target.includes("/") && !target.includes("\\") && target.endsWith(".exe")) {
          const { spawn } = await import("node:child_process");
          spawn(target, [], { detached: true, stdio: 'ignore', shell: true }).unref();
          return { success: true };
        }
        
        const errorMsg = await shell.openPath(target);
        if (errorMsg) {
          // Fallback cho trường hợp shell.openPath thất bại (có thể do lỗi quyền hoặc đường dẫn)
          const { spawn } = await import("node:child_process");
          spawn(`"${target}"`, [], { detached: true, stdio: 'ignore', shell: true }).unref();
        }
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
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

  ipcMain.handle("network:get-ip", () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return "localhost";
  });

  // Biến lưu Expo process đang chạy nền
  let expoProcess = null;
  let expoTunnelUrl = null;

  ipcMain.handle("companion:get-tunnel", () => expoTunnelUrl);
  // Port 8080's own tunnel (camera/audio stream) — separate from the Expo
  // (port 8081) tunnel above. See companion-server.mjs for why these can't share one.
  ipcMain.handle("companion:get-ws-tunnel", () => getCompanionWsTunnel());
  ipcMain.handle("companion:get-ws-token", () => getCompanionWsToken());
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
  ipcMain.on("companion:webrtc-frame", (e, base64) => {
    if (typeof sendFrameToGemini === 'function') sendFrameToGemini(base64);
  });
  ipcMain.on("companion:webrtc-audio", (e, pcm) => {
    sendAudioChunk(pcm);
  });

  ipcMain.handle("companion:start-expo", () => {
    // Nếu process đã chạy, trả về ngay — tránh khởi động lại
    if (expoProcess) return { status: "running" };
    expoTunnelUrl = null;

    const companionPath = path.join(repoRoot, "iris-companion");
    if (!fs.existsSync(companionPath)) return { status: "not_found" };

    // BUG-EXPO-01 FIX: execFileSync đã được import ở đầu file — KHÔNG dùng require() trong ESM.
    // Giải phóng cổng 8081 trước khi khởi động để Expo KHÔNG bao giờ gặp cổng bận
    // và hỏi "Use port 8082?" — câu hỏi đó trong CI mode sẽ skip + exit ngay.
    try {
      const killPortCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      execFileSync(killPortCmd, ["--yes", "kill-port", "--port", "8081"], {
        stdio: "ignore",
        timeout: 10000,
        windowsHide: true,
      });
    } catch (e) {
      // Bỏ qua nếu không có process nào đang chiếm cổng
    }

    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    expoProcess = spawn(npxCmd, ["expo", "start", "--lan", "--port", "8081"], {
      cwd: companionPath,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        EXPO_NO_TELEMETRY: "1",
      },
    });

    expoProcess.stdout.on("data", (data) => {
      const str = data.toString();
      console.log("[Companion][Expo]", str.trimEnd());

      // Lọc tìm URL của ngrok từ output của Expo (có thể là .ngrok.io, .ngrok-free.app, hoặc .exp.direct)
      const match = str.match(/(exp:\/\/[^\s]+(?:\.ngrok|\.exp\.direct)[^\s]*)/);
      if (match) {
        expoTunnelUrl = match[1];
        console.log("[Companion][Expo] Found tunnel URL:", expoTunnelUrl);
      }
    });

    expoProcess.stderr.on("data", (data) => {
      const msg = data.toString().trimEnd();
      // Expo ghi nhiều thứ ra stderr (metro bundler logs) — log ở warn chứ không error
      console.warn("[Companion][Expo][stderr]", msg);
    });

    expoProcess.on("error", (err) => {
      console.error("[Companion] Failed to start Expo:", err.message);
      expoProcess = null;
    });

    expoProcess.on("exit", (code, signal) => {
      console.log(`[Companion] Expo process exited — code: ${code}, signal: ${signal}`);
      expoProcess = null;
    });

    return { status: "started" };
  });

  // Dọn dẹp Expo process khi app đóng
  app.on("before-quit", () => {
    if (expoProcess) {
      try { expoProcess.kill(); } catch (e) { /* bỏ qua */ }
      expoProcess = null;
    }
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
  ipcMain.handle("config:save", (_event, updates) => writeUserConfig(updates));
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
  ipcMain.on("live:audio", (_event, chunk) => sendAudioChunk(chunk));

  ipcMain.on("vision:desk-frame", (_event, base64DataUrl) => {
    if (!liveSession) return;
    // Remove "data:image/jpeg;base64," prefix
    const base64 = base64DataUrl.split(",")[1];
    if (!base64) return;
    liveSession.sendRealtimeInput([{
      mimeType: "image/jpeg",
      data: base64,
    }]);
  });

  // FEAT-VIS-DIRECT-01: nhận frame JPEG/base64 mà Renderer đã tự vẽ từ
  // <canvas> (drawImage từ MediaStream Companion WebRTC hoặc camera robot)
  // — KHÔNG dùng desktopCapturer ở đây, Main chỉ chuyển tiếp thẳng vào
  // Gemini live session, giống hệt cách vision:desk-frame hoạt động.
  ipcMain.on("vision:camera-stream-frame", (_event, base64DataUrl) => {
    handleCameraStreamFrame(base64DataUrl);
  });

  ipcMain.on("iris:hand-gesture", async (_event, gesture) => {
    try {
      if (gesture === "pinch") {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          else mainWindow.minimize();
        }
      } else if (gesture === "swipe_left" || gesture === "swipe_right") {
        const { keyboard, Key } = await getNutJs();
        if (gesture === "swipe_right") {
          // Swipe Right -> Chuyển ứng dụng (Alt + Tab)
          await keyboard.pressKey(Key.LeftAlt, Key.Tab);
          await keyboard.releaseKey(Key.LeftAlt, Key.Tab);
        } else {
          // Swipe Left -> Chuyển ứng dụng ngược lại (Alt + Shift + Tab)
          await keyboard.pressKey(Key.LeftAlt, Key.LeftShift, Key.Tab);
          await keyboard.releaseKey(Key.LeftAlt, Key.LeftShift, Key.Tab);
        }
      } else if (gesture === "zoom_in") {
        const { keyboard, Key } = await getNutJs();
        await keyboard.pressKey(Key.LeftControl, Key.Equal);
        await keyboard.releaseKey(Key.LeftControl, Key.Equal);
      } else if (gesture === "zoom_out") {
        const { keyboard, Key } = await getNutJs();
        await keyboard.pressKey(Key.LeftControl, Key.Minus);
        await keyboard.releaseKey(Key.LeftControl, Key.Minus);
      } else if (gesture === "thumb_up") {
        const { keyboard, Key } = await getNutJs();
        await keyboard.pressKey(Key.LeftSuper);
        await keyboard.releaseKey(Key.LeftSuper);
      } else if (gesture === "thumb_down") {
        const { keyboard, Key } = await getNutJs();
        await keyboard.pressKey(Key.LeftAlt, Key.F4);
        await keyboard.releaseKey(Key.LeftAlt, Key.F4);
      } else if (gesture === "victory") {
        const { keyboard, Key } = await getNutJs();
        await keyboard.pressKey(Key.LeftSuper, Key.D);
        await keyboard.releaseKey(Key.LeftSuper, Key.D);
      } else if (typeof gesture === "object") {
        const { mouse, Point, Button } = await getNutJs();
        if (gesture.type === "grab") {
          if (!global.isGrabbing) {
            global.isGrabbing = true;
            await mouse.pressButton(Button.LEFT);
          }
          await mouse.setPosition(new Point(gesture.x, gesture.y));
        } else if (gesture.type === "release") {
          if (global.isGrabbing) {
            global.isGrabbing = false;
            await mouse.releaseButton(Button.LEFT);
          }
        }
      }
    } catch (e) {
      emitEvent({ type: "log", level: "error", message: `Hand gesture error: ${e.message}` });
    }
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

  // Register Super+Shift+V to toggle screen vision
  const visionRegistered = globalShortcut.register("Super+Shift+V", () => {
    toggleScreenVision();
  });
  if (!visionRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register Screen Vision hotkey Super+Shift+V.` });
  }

  const resetRegistered = globalShortcut.register("Super+Shift+R", () => {
    if (mainWindow) {
      mainWindow.webContents.send("ui:reset-to-boot");
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  if (!resetRegistered) console.error("Failed to register Super+Shift+R");

  // Register Win+Shift+L to toggle Ollama localchat
  const localchatRegistered = globalShortcut.register("Super+Shift+L", () => {
    localchatEnabled = !localchatEnabled;
    emitEvent({ type: "log", level: "info", message: `Localchat mode is now ${localchatEnabled ? "ON" : "OFF"}.` });
    notifyIris([
      "SYSTEM_EVENT_LOCALCHAT_TOGGLE",
      `localchat_enabled: ${localchatEnabled}`,
      "instructions_to_iris:",
      "- If true, you are now a Voice Relay for a local AI. When the user speaks, DO NOT ANSWER their query directly. Immediately call `submit_local_chat` with their exact words.",
      "- If false, you are back to normal mode. Stop calling `submit_local_chat` and answer normally.",
    ]);
  });
  if (!localchatRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register Localchat hotkey Super+Shift+L.` });
  }

  // Register Win+Shift+C to toggle Desk Vision (Continuous Mode)
  const deskVisionRegistered = globalShortcut.register("Super+Shift+C", () => {
    if (mainWindow) {
      mainWindow.webContents.send("vision:toggle-desk-continuous");
    }
  });
  if (!deskVisionRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register Desk Vision hotkey Super+Shift+C.` });
  }

  // Register Alt+R to toggle Robot Cameras PiP
  const robotPipRegistered = globalShortcut.register("Alt+R", () => {
    if (mainWindow) {
      mainWindow.webContents.send("ui:toggle-robot-pip");
    }
  });
  if (!robotPipRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register Robot PiP hotkey Alt+R.` });
  }

  for (let i = 1; i <= 9; i++) {
    globalShortcut.register(`CommandOrControl+Alt+${i}`, () => {
      if (mainWindow) {
        mainWindow.webContents.send("ui:expand-robot-pip", i);
      }
    });
  }

  // Register Alt+C to toggle Companion Camera PiP
  const companionPipRegistered = globalShortcut.register("Alt+C", () => {
    if (mainWindow) {
      mainWindow.webContents.send("ui:toggle-companion-pip");
    }
  });
  if (!companionPipRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register Companion PiP hotkey Alt+C.` });
  }

  // Register Alt+H to toggle Smart Home Cameras PiP (FEAT-SH-CAM-01)
  const smartHomePipRegistered = globalShortcut.register("Alt+H", () => {
    if (mainWindow) {
      mainWindow.webContents.send("ui:toggle-smarthome-pip");
    }
  });
  if (!smartHomePipRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register Smart Home Cameras PiP hotkey Alt+H.` });
  }

  // Register Alt+M to toggle Meeting Recorder
  const meetingRecorderRegistered = globalShortcut.register("Alt+M", () => {
    toggleMeetingRecording();
  });
  if (!meetingRecorderRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register Meeting Recorder hotkey Alt+M.` });
  }

  // Register Alt+T to toggle Live Teleprompter
  const teleprompterRegistered = globalShortcut.register("Alt+T", () => {
    toggleLiveTranscriber();
  });
  if (!teleprompterRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register Teleprompter hotkey Alt+T.` });
  }

  // Register Alt+A to toggle AI Copilot Mode
  const copilotToggleRegistered = globalShortcut.register("Alt+A", () => {
    toggleCopilotMode();
  });
  if (!copilotToggleRegistered) {
    emitEvent({ type: "log", level: "error", message: `Could not register AI Copilot hotkey Alt+A.` });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  initMusicWidget();
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("before-quit", async () => {
  // Dọn dẹp HUD stats interval trước khi thoát
  stopHudStatsInterval();
  stopSmarthomeRuleTimer();
  browserAgent.browserClose().catch(() => {});
  stopLive();
  // BUGFIX-COMP-NGROK-01 (cont.): stopCompanionServer() is now async and
  // actually tears down the ngrok agent (ngrok.kill()) instead of just
  // disconnecting the tunnel. It must be awaited here, or Electron will
  // exit while that teardown is still in flight — leaving the agent alive
  // and causing "tunnel already exists" on the next launch.
  await stopCompanionServer();
  stopMusicWidget();
  // BUG-SIDECAR-01 FIX: meeting_recorder.py (Alt+M) and live_transcriber.py
  // (Alt+T) were never touched here. Nếu người dùng đóng app trong lúc đang
  // ghi âm/nhắc bài, hai sidecar Python này (và handle mic của chúng) tiếp
  // tục chạy ngầm vô thời hạn — zombie process thật sự, không do OS dọn hộ
  // vì tiến trình con vẫn còn stdin/stdout mở. Force-kill trực tiếp thay vì
  // gọi stopSidecar() (ghi "stop\n" rồi chờ exit) vì app đang thoát ngay
  // lập tức, không có thời gian chờ graceful shutdown.
  if (meetingRecorder && meetingRecorder.proc && meetingRecorder.state !== "dead") {
    try { meetingRecorder.proc.kill("SIGKILL"); } catch { /* ignore */ }
  }
  if (liveTranscriber && liveTranscriber.proc && liveTranscriber.state !== "dead") {
    try { liveTranscriber.proc.kill("SIGKILL"); } catch { /* ignore */ }
  }
  // BUG-COMP-05 FIX: Kill zombie expo process so it doesn't hold port 8081.
  if (typeof expoProcess !== "undefined" && expoProcess && !expoProcess.killed) {
    try { expoProcess.kill(); } catch { }
  }
  // BUG-HAND-01 FIX: Release stuck mouse button if app closes during a grab.
  if (global.isGrabbing) {
    try {
      const { mouse, Button } = await getNutJs();
      await mouse.releaseButton(Button.LEFT);
      global.isGrabbing = false;
    } catch { /* ignore — best-effort cleanup */ }
  }
  // The app is exiting regardless, so this just signals live subprocesses to
  // die with it — run-queue.mjs owns the runs map, so kill children directly
  // via list() rather than mutating run.status from outside the module.
  for (const run of runQueue.list()) {
    if (run.child) run.child.kill("SIGTERM");
  }
  closeAllPoSessions();
  closeAllStudySessions();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
