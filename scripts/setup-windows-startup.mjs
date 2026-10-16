import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export function setupWindowsStartup() {
  if (process.platform !== "win32") return;

  try {
    const batPath = path.join(rootDir, "scripts", "launch-iris.bat");
    const batContent = [
      "@echo off",
      'cd /d "%~dp0\\.."',
      'set "PATH=%PATH%;C:\\Program Files\\nodejs;%APPDATA%\\npm"',
      "call npm run dev",
      "",
    ].join("\r\n");
    fs.writeFileSync(batPath, batContent, "ascii");

    const vbsPath = path.join(rootDir, "scripts", "launch-iris.vbs");
    const vbsContent = [
      'Set WshShell = CreateObject("WScript.Shell")',
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      'scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)',
      'batPath = scriptDir & "\\launch-iris.bat"',
      'WshShell.Run "cmd.exe /c """ & batPath & """", 0, False',
      '',
    ].join("\r\n");
    fs.writeFileSync(vbsPath, vbsContent, "ascii");

    const psFile = path.join(rootDir, "scripts", "create-shortcuts.ps1");
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
      stdio: "pipe",
      windowsHide: true,
    });
    console.log("[Startup] Da cai dat loi tat Iris tai Startup, Desktop va Start Menu voi phim tat Ctrl+Alt+I.");
  } catch (err) {
    console.warn("[Startup] Khong the tu dong tao loi tat khoi dong:", err?.message || err);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupWindowsStartup();
}
