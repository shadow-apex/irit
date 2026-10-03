/**
 * electron/main/window-manager.mjs
 *
 * Owns the single BrowserWindow, the Glass HUD window-shape morph, the
 * system tray + its menu, the global HUD hotkey, and the app menu. This is
 * one of the handful of main-process modules that talks to Electron's
 * window/tray/menu APIs directly (see CLAUDE.md).
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import electron from "electron";
const { app, BrowserWindow, Menu, Tray, screen, globalShortcut, nativeImage } = electron;
import { setCompanionMainWindow } from "../companion-server.mjs";
import { emitToRenderer } from "./events.mjs";
import { liveStatus } from "./gemini-live.mjs";
import { runQueue } from "./claude-runner.mjs";
import { repoRoot } from "./paths.mjs";

export const iconPath = path.join(repoRoot, "build", "icon.png");
export const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;

export let mainWindow = null;
// Ported-capability accessor: canvas.mjs/second-brain.mjs receive this as an
// injected dependency rather than importing electron themselves.
export function getMainWindow() {
  return mainWindow;
}

// Unused in the original monolithic main.mjs (kept as-is across the split —
// see CLAUDE.md "keep old logic working exactly as before").
let privacyCamEnabled = false;
let privacyWindow = null;
let hudStatsInterval = null; // Guard: chi tao mot interval duy nhat, tat duoc khi quit

export function stopHudStatsInterval() {
  if (hudStatsInterval) {
    clearInterval(hudStatsInterval);
    hudStatsInterval = null;
  }
}

export function createWindow() {
  // Frameless + transparent from birth so the same window can morph into the
  // Glass HUD overlay — Electron cannot toggle `frame`/`transparent` after
  // creation. The deck paints its own rounded background in CSS; TopBar's
  // custom win-controls replace the native traffic lights this gives up.
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 980,
    minHeight: 800,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    fullscreenable: false,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(repoRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Audio capture/playback and the HUD must keep running when occluded.
      backgroundThrottling: false,
    },
  });
  // FIX-COMP-STALE-WINDOW: đăng ký cửa sổ MỚI này với companion-server ngay
  // lập tức, để relay SDP/ICE Offer-Answer từ điện thoại luôn được forward
  // tới đúng cửa sổ đang hiển thị — không bị "đóng băng" vào cửa sổ cũ nếu
  // app từng đóng/mở lại cửa sổ trước đó (xem giải thích chi tiết trong
  // companion-server.mjs).
  setCompanionMainWindow(mainWindow);
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  const useProd = app.isPackaged || process.env.IRIS_START_PROD === "1";
  if (process.env.IRIS_DEBUG_CONSOLE === "1") {
    mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
      console.log(`[RENDERER][${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on("render-process-gone", (_e, details) => {
      console.log("[RENDERER][crashed]", JSON.stringify(details));
    });
  }
  if (useProd) mainWindow.loadFile(path.join(repoRoot, "dist", "index.html"));
  else mainWindow.loadURL(devUrl);
  // Avoid a translucent first-paint flash on the transparent window.
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
    uiMode = "deck";
    setCompanionMainWindow(null);
  });

  // Iron Man HUD Stats interval — chỉ tạo một lần duy nhất.
  // createWindow() có thể được gọi lại (ví dụ trên macOS khi click Dock)
  // nên guard này ngăn việc tích lũy nhiều interval đồng thời.
  if (!hudStatsInterval) {
    hudStatsInterval = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const allRuns = runQueue.list();
      let active = 0;
      let queued = 0;
      for (const run of allRuns) {
        if (run.status === "running") active++;
        else if (run.status === "queued") queued++;
      }
      const stats = {
        ramTotal: os.totalmem(),
        ramFree: os.freemem(),
        activeTasks: active,
        queuedTasks: queued
      };
      mainWindow.webContents.send("hud:stats", stats);
    }, 2000);
  }
}

// ===== Glass HUD =====
// One window, two shapes. Deck: a normal rounded app window. HUD: the same
// window stretched over the whole screen, transparent, always on top, and
// click-through except where the renderer marks interactive elements — Iris
// floats over everything while you keep working underneath.
export let uiMode = "deck";
export let deckBounds = null;

export function enterHud() {
  if (!mainWindow || uiMode === "hud") return;
  uiMode = "hud";
  deckBounds = mainWindow.getBounds();
  // Let the renderer fade the deck out before the window jumps to full screen.
  emitToRenderer("hud:mode", { mode: "hud" });
  setTimeout(() => {
    if (!mainWindow || uiMode !== "hud") return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    mainWindow.setHasShadow(false);
    mainWindow.setMinimumSize(1, 1);
    mainWindow.setBounds(display.bounds);
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.show();
  }, 170);
}

export function exitHud() {
  if (!mainWindow || uiMode === "deck") return;
  uiMode = "deck";
  mainWindow.setIgnoreMouseEvents(false);
  // Tell the renderer first (the deck mounts invisible and fades in), then
  // restore the window while it's still transparent — no stretched flash.
  emitToRenderer("hud:mode", { mode: "deck" });
  setTimeout(() => {
    if (!mainWindow || uiMode !== "deck") return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
    mainWindow.setHasShadow(true);
    mainWindow.setMinimumSize(980, 800);
    if (deckBounds) mainWindow.setBounds(deckBounds);
    mainWindow.show();
    mainWindow.focus();
  }, 170);
}

export function toggleHud() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (uiMode === "hud") exitHud();
  else enterHud();
}

// ===== Tray (menu-bar presence) =====
export let tray = null;

export function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: liveStatus.running ? "Sleep Iris" : "Wake Iris",
        click: () => emitToRenderer(liveStatus.running ? "iris:sleep" : "iris:wake", {}),
      },
      { label: uiMode === "hud" ? "Exit Glass HUD" : "Enter Glass HUD", click: () => toggleHud() },
      { type: "separator" },
      {
        label: "Show Deck",
        click: () => {
          if (!mainWindow) createWindow();
          else {
            exitHud();
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: "separator" },
      { label: "Quit Iris", role: "quit" },
    ]),
  );
}

export function createTray() {
  const trayIconPath = path.join(repoRoot, "build", "trayTemplate.png");
  if (!fs.existsSync(trayIconPath)) return;
  tray = new Tray(trayIconPath);
  tray.setToolTip("Iris");
  updateTrayMenu();
}

export function hudHotkey() {
  return process.env.IRIS_HUD_HOTKEY || "Alt+Space";
}

export function installAppMenu() {
  if (process.platform !== "darwin") return;
  app.setAboutPanelOptions({
    applicationName: "Iris",
    applicationVersion: app.getVersion(),
    ...(appIcon ? { iconPath } : {}),
  });
  const menu = Menu.buildFromTemplate([
    {
      label: "Iris",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}
