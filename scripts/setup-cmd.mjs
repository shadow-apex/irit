import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export function setupCmd() {
  if (process.platform === "win32") {
    try {
      const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
      const targetDir = path.join(localAppData, "Microsoft", "WindowsApps");

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const cmdFile = path.join(targetDir, "iris.cmd");
      const content = `@echo off\r\ncd /d "${rootDir}"\r\nnpm run dev %*\r\n`;
      fs.writeFileSync(cmdFile, content, "utf8");

      console.log(`[iris] Da tu dong cai dat/cap nhat lenh 'iris' vao CMD tai:\n       ${cmdFile}`);
    } catch (err) {
      console.warn(`[iris] Khong the ghi lenh CMD: ${err?.message || err}`);
    }
  } else {
    // macOS / Linux fallback
    try {
      const home = os.homedir();
      const localBin = path.join(home, ".local", "bin");
      if (!fs.existsSync(localBin)) {
        fs.mkdirSync(localBin, { recursive: true });
      }
      const shFile = path.join(localBin, "iris");
      const shContent = `#!/usr/bin/env bash\ncd "${rootDir}"\nnpm run dev "$@"\n`;
      fs.writeFileSync(shFile, shContent, { encoding: "utf8", mode: 0o755 });
      console.log(`[iris] Da tu dong cai dat lenh 'iris' tai:\n       ${shFile}`);
    } catch {}
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupCmd();
}
