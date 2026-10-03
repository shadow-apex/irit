/**
 * electron/main/claude-spawn.mjs
 *
 * Tìm và chạy binary `claude` AN TOÀN (R-03/R-04/R-05). Module thuần: chỉ dùng node:*, không import
 * electron — nên test được bằng `node --test`.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

let loggedBinary = null;

/** Ứng viên cài đặt `claude` trên Windows, ưu tiên .exe (R-03). */
export function windowsClaudeCandidates(env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const out = [
    path.join(home, ".local", "bin", "claude.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "claude", "claude.exe"),
    env.APPDATA && path.join(env.APPDATA, "npm", "claude.exe"),
    env.APPDATA && path.join(env.APPDATA, "npm", "claude.cmd"),
  ];
  return out.filter(Boolean);
}

export function claudeBinary() {
  if (process.env.IRIS_CLAUDE_BIN) return process.env.IRIS_CLAUDE_BIN;
  // A packaged .app/.exe does not inherit the shell PATH, so probe common installs.
  const known =
    process.platform === "win32"
      ? windowsClaudeCandidates()
      : [
          path.join(os.homedir(), ".local", "bin", "claude"),
          "/usr/local/bin/claude",
          "/opt/homebrew/bin/claude",
        ];
  for (const candidate of known) {
    if (fs.existsSync(candidate)) {
      if (loggedBinary !== candidate) {
        loggedBinary = candidate;
        console.log(`[IRIS][claude] using ${candidate}`);
      }
      return candidate;
    }
  }
  return process.platform === "win32" ? "claude.cmd" : "claude";
}

// ---------------------------------------------------------------------------
// R-03: chạy `claude` AN TOÀN trên Windows.
//  * `execFile("claude.cmd")` ném EINVAL (Node ≥ 20.12 chặn spawn .cmd/.bat không qua shell);
//  * `spawn(..., {shell:true})` cho phép `&`, `|`, `%VAR%`, `"` trong task của người dùng/Gemini
//    thực thi như lệnh cmd.exe (injection) và làm hỏng tham số tiếng Việt.
// Chiến lược: .exe -> chạy thẳng; .cmd -> chạy `node cli.js` cạnh nó (không shell); chỉ khi không có
// cli.js mới dùng cmd.exe với quoting nghiêm ngặt và TỪ CHỐI đối số nguy hiểm.
// ---------------------------------------------------------------------------
const CMD_UNSAFE = /[%^&|<>\r\n\0]/;

export function quoteCmdArg(arg) {
  const a = String(arg);
  if (CMD_UNSAFE.test(a)) {
    throw new Error(
      "Đối số chứa ký tự không an toàn cho cmd.exe (% ^ & | < > hoặc xuống dòng). " +
        "Hãy cài claude.exe (installer native) hoặc đặt IRIS_CLAUDE_BIN trỏ tới claude.exe.",
    );
  }
  return `"${a.replace(/"/g, '""')}"`;
}

/**
 * @returns {{command:string,args:string[],options:object}} cấu hình spawn/execFile (KHÔNG dùng shell)
 */
export function buildClaudeSpawn(bin, args, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? fs.existsSync;
  const execPath = deps.execPath ?? process.execPath;
  const lower = String(bin).toLowerCase();
  if (platform !== "win32" || !(lower.endsWith(".cmd") || lower.endsWith(".bat"))) {
    return { command: bin, args: [...args], options: {} };
  }
  const cli = path.join(path.dirname(bin), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
  if (exists(cli)) {
    return { command: execPath, args: [cli, ...args], options: { env: { ELECTRON_RUN_AS_NODE: "1" } } };
  }
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `"${[bin, ...args.map(quoteCmdArg)].map((x, i) => (i === 0 ? quoteCmdArg(x) : x)).join(" ")}"`],
    options: { windowsVerbatimArguments: true },
  };
}

/** spawn `claude` an toàn; nhóm tiến trình riêng trên POSIX để killTree dừng được cả cây (R-05). */
export function spawnClaude(args, { cwd, env = process.env, stdio = ["ignore", "pipe", "pipe"] } = {}) {
  const spec = buildClaudeSpawn(claudeBinary(), args);
  return spawn(spec.command, spec.args, {
    cwd,
    stdio,
    env: { ...env, ...(spec.options.env || {}) },
    windowsHide: true,
    windowsVerbatimArguments: spec.options.windowsVerbatimArguments === true,
    shell: false,
    detached: process.platform !== "win32",
  });
}

