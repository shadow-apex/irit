import { ipcMain, globalShortcut } from "electron";
import { exec } from "child_process";
import { mainWindow } from "./window-manager.mjs";

let stopListening = null;

// B-03: `windows-media-sessions` là gói chỉ-win32 (optionalDependencies). Import
// tĩnh làm app KHÔNG khởi động được trên macOS/Linux, nên nạp động + bắt lỗi.
let wms = null;
if (process.platform === "win32") {
  try {
    wms = await import("windows-media-sessions");
  } catch (e) {
    console.warn("[music] windows-media-sessions unavailable:", e?.message || e);
  }
}

// Gửi phím ảo qua PowerShell (không cần thư viện C++)
const sendMediaKey = (keyName) => {
  let method = "";
  if (keyName === "play-pause") method = "PlayPause";
  else if (keyName === "next") method = "NextTrack";
  else if (keyName === "prev") method = "PrevTrack";
  else return;

  const script = `
    $code = @"
    using System;
    using System.Runtime.InteropServices;
    public class Keyboard {
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
        public static void PlayPause() { keybd_event(0xB3, 0, 0, 0); keybd_event(0xB3, 0, 2, 0); }
        public static void NextTrack() { keybd_event(0xB0, 0, 0, 0); keybd_event(0xB0, 0, 2, 0); }
        public static void PrevTrack() { keybd_event(0xB1, 0, 0, 0); keybd_event(0xB1, 0, 2, 0); }
    }
"@
    Add-Type -TypeDefinition $code
    [Keyboard]::${method}()
  `;
  exec(`powershell -NoProfile -Command "${script.replace(/\n/g, '')}"`, (err) => {
    if (err) console.error("Failed to send media key:", err);
  });
};

export const initMusicWidget = () => {
  // Không có thư viện (macOS/Linux hoặc cài thiếu) -> widget nhạc tắt hẳn, không ném lỗi.
  if (!wms) return;

  // Lắng nghe lệnh điều khiển từ Frontend
  ipcMain.on("music:control", (_event, action) => {
    sendMediaKey(action);
  });

  // Lắng nghe sự thay đổi bài hát trên Windows
  stopListening = wms.onSessionsChanged((sessions) => {
    if (!mainWindow) return;
    
    // Tìm session đang active (playing) hoặc lấy cái đầu tiên
    const active = sessions.find(s => s.playbackStatus === 'playing') || sessions[0];
    
    if (active) {
      mainWindow.webContents.send("music:update", {
        title: active.title || "",
        artist: active.artist || "",
        status: active.playbackStatus,
        source: active.sourceAppDisplayName || "Unknown"
      });
    } else {
      mainWindow.webContents.send("music:update", null);
    }
  });

  // Register Ctrl+M
  const registered = globalShortcut.register("CommandOrControl+M", () => {
    if (mainWindow) {
      mainWindow.webContents.send("music:toggle-widget");
    }
  });

  if (!registered) {
    console.error("Could not register Music Widget hotkey Ctrl+M.");
  }
};

export const stopMusicWidget = () => {
  if (stopListening) {
    stopListening();
    stopListening = null;
  }
};
