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
      "title Iris AI Assistant",
      "echo ========================================================",
      "echo   Iris AI Assistant dang chay...",
      "echo   (Dong cua so nay se tat Iris)",
      "echo ========================================================",
      'cd /d "%~dp0\\.."',
      'set "PATH=%PATH%;C:\\Program Files\\nodejs;%APPDATA%\\npm"',
      'if not exist "dist\\index.html" (',
      "  echo Dang build giao dien Iris lan dau...",
      "  call npm run build",
      ")",
      "node scripts/run-electron.mjs --prod",
      "",
    ].join("\r\n");
    fs.writeFileSync(batPath, batContent, "ascii");

    const vbsPath = path.join(rootDir, "scripts", "launch-iris.vbs");
    const vbsContent = [
      'Set WshShell = CreateObject("WScript.Shell")',
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      'scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)',
      'batPath = scriptDir & "\\launch-iris.bat"',
      'WshShell.Run "cmd.exe /c """ & batPath & """", 1, False',
      "",
    ].join("\r\n");
    fs.writeFileSync(vbsPath, vbsContent, "ascii");

    // Ensure IrisDaemon.exe is compiled
    const daemonExe = path.join(rootDir, "scripts", "IrisDaemon.exe");
    const daemonCs = path.join(rootDir, "scripts", "IrisDaemon.cs");
    if (!fs.existsSync(daemonExe) && fs.existsSync(daemonCs)) {
      const cscPaths = [
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
        "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
      ];
      const csc = cscPaths.find((p) => fs.existsSync(p));
      if (csc) {
        try {
          execSync(`"${csc}" /target:winexe /out:"${daemonExe}" "${daemonCs}"`, {
            stdio: "pipe",
            windowsHide: true,
          });
        } catch (e) {
          console.warn("[Startup] Failed to compile IrisDaemon:", e?.message || e);
        }
      }
    }

    const markerFile = path.join(rootDir, "scripts", ".startup-installed");
    if (!fs.existsSync(markerFile)) {
      const psFile = path.join(rootDir, "scripts", "create-shortcuts.ps1");
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
        stdio: "pipe",
        windowsHide: true,
      });
      try { fs.writeFileSync(markerFile, "1\n", "ascii"); } catch {}
      console.log("[Startup] Da cai dat IrisDaemon va loi tat Iris tai Startup, Desktop, Start Menu.");
    }
  } catch (err) {
    console.warn("[Startup] Khong the tu dong tao loi tat khoi dong:", err?.message || err);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupWindowsStartup();
}
