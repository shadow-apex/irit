/**
 * electron/main/omni-server.mjs
 *
 * S-01: quản lý vòng đời OmniParser (reponew/toado/api_server.py).
 *   * Electron main là bên DUY NHẤT khởi động server, bind 127.0.0.1.
 *   * Token ngẫu nhiên mới cho mỗi lần chạy app (IRIS_OMNI_TOKEN nếu người dùng tự
 *     chạy server riêng); mọi request gắn header X-Iris-Token.
 *   * Khởi động lười (lúc Computer Use cần lần đầu) và được dọn khi thoát app.
 *
 * Module thuần node (không import electron).
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unpackedRepoRoot, pythonBin } from "./paths.mjs";
import { killTree } from "./process-utils.mjs";

let stableToken = null;
let child = null;
let startPromise = null;
let logger = (level, msg) => console[level === "error" ? "error" : "log"](`[omni] ${msg}`);

export function setOmniLogger(fn) {
  if (typeof fn === "function") logger = fn;
}

export function omniToken() {
  const envTok = String(process.env.IRIS_OMNI_TOKEN || "").trim();
  if (envTok.length >= 16) return envTok;
  if (stableToken) return stableToken;

  const tokenPath = path.join(os.tmpdir(), ".iris_omni_token");
  try {
    if (fs.existsSync(tokenPath)) {
      const saved = fs.readFileSync(tokenPath, "utf8").trim();
      if (saved.length >= 16) {
        stableToken = saved;
        return stableToken;
      }
    }
  } catch {}

  stableToken = crypto.randomBytes(24).toString("hex");
  try {
    fs.writeFileSync(tokenPath, stableToken, { encoding: "utf8", mode: 0o600 });
  } catch {}
  return stableToken;
}

export function killPortOccupant(port) {
  const targetPort = String(port).trim();
  if (process.platform === "win32") {
    try {
      const res = spawnSync("netstat", ["-ano", "-p", "tcp"], { windowsHide: true, timeout: 5000 });
      if (res.stdout) {
        const text = res.stdout.toString();
        for (const line of text.split(/\r?\n/)) {
          if (line.includes(`:${targetPort}`) && line.includes("LISTENING")) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (pid && pid > 0 && pid !== process.pid) {
              logger("info", `Dọn tiến trình cũ PID ${pid} đang chiếm cổng ${targetPort}`);
              killTree(pid);
            }
          }
        }
      }
    } catch {}
  }
}

/** Header xác thực cho mọi request tới OmniParser. */
export function omniAuthHeaders(extra = {}) {
  return { "X-Iris-Token": omniToken(), ...extra };
}

function baseUrl() {
  const raw = process.env.OMNIPARSER_API_URL || "http://127.0.0.1:8000/parse";
  try {
    return new URL(raw);
  } catch {
    return new URL("http://127.0.0.1:8000/parse");
  }
}

function isLocalHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

async function healthy(origin) {
  try {
    const res = await fetch(`${origin}/health`, {
      headers: omniAuthHeaders(),
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function cleanupServerPipes(proc) {
  if (!proc) return;
  for (const s of [proc.stdin, proc.stdout, proc.stderr]) {
    if (!s) continue;
    try { s.removeAllListeners(); } catch {}
    try { if (!s.destroyed) s.destroy(); } catch {}
  }
}

function spawnServer(url) {
  const dir = path.join(unpackedRepoRoot(), "assets", "reponew", "toado");
  const port = url.port || "8000";
  logger("info", `đang khởi động OmniParser (127.0.0.1:${port})…`);
  const proc = spawn(pythonBin(), [path.join(dir, "api_server.py")], {
    cwd: dir,
    env: {
      ...process.env,
      IRIS_OMNI_TOKEN: omniToken(),
      IRIS_OMNI_HOST: "127.0.0.1",
      IRIS_OMNI_PORT: String(port),
      PYTHONUNBUFFERED: "1",
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32", // để killTree dừng được cả nhóm trên POSIX
  });
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  const tail = (d) => {
    const line = String(d).trim().split("\n").pop();
    if (line) logger("info", line.slice(0, 200));
  };
  proc.stdout.on("data", tail);
  proc.stderr.on("data", tail);
  proc.on("error", (e) => {
    logger("error", `không chạy được api_server.py: ${e.message}`);
    cleanupServerPipes(proc);
    if (child === proc) child = null;
  });
  proc.on("exit", (code) => {
    if (code) logger("error", `OmniParser thoát (code ${code}). Kiểm tra thư viện Python trong assets/reponew/toado/requirements.txt.`);
    cleanupServerPipes(proc);
    if (child === proc) child = null;
  });
  try { proc.unref(); } catch {}
  try { proc.stdout?.unref?.(); } catch {}
  try { proc.stderr?.unref?.(); } catch {}
  return proc;
}

// Đảm bảo không bao giờ để lại tiến trình zombie api_server.py khi tiến trình cha thoát
process.once("exit", () => {
  if (child) {
    const c = child;
    child = null;
    try { killTree(c); } catch {}
    cleanupServerPipes(c);
  }
});

/**
 * Đảm bảo OmniParser đang chạy & trả lời /health.
 * @returns {Promise<boolean>} false nếu bị tắt, không khởi động được hoặc quá hạn chờ.
 */
export function ensureOmniServer({ timeoutMs = 90_000 } = {}) {
  if (String(process.env.OMNIPARSER_ENABLED ?? "true").toLowerCase() === "false") {
    return Promise.resolve(false);
  }
  const url = baseUrl();
  // Server ở máy khác do người dùng tự quản: không spawn, dùng IRIS_OMNI_TOKEN của họ.
  if (!isLocalHost(url.hostname)) return Promise.resolve(true);

  if (startPromise) return startPromise;
  startPromise = (async () => {
    try {
      const origin = url.origin;
      if (await healthy(origin)) return true;
      killPortOccupant(url.port || "8000");
      if (!child) child = spawnServer(url);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!child) return false; // tiến trình đã chết
        if (await healthy(origin)) return true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      logger("error", `OmniParser chưa sẵn sàng sau ${Math.round(timeoutMs / 1000)}s`);
      if (child) {
        const c = child;
        child = null;
        try { killTree(c); } catch {}
        cleanupServerPipes(c);
      }
      return false;
    } finally {
      startPromise = null;
    }
  })();
  return startPromise;
}

export function stopOmniServer() {
  if (child) {
    const c = child;
    child = null;
    killTree(c);
    cleanupServerPipes(c);
  }
  const url = baseUrl();
  killPortOccupant(url.port || "8000");
}

export async function getOmniStatus() {
  const enabled = String(process.env.OMNIPARSER_ENABLED ?? "true").toLowerCase() !== "false";
  const url = baseUrl();
  const origin = url.origin;
  let running = false;
  let mode = null;
  try {
    const res = await fetch(`${origin}/health`, {
      headers: omniAuthHeaders(),
      signal: AbortSignal.timeout(1800),
    });
    if (res.ok) {
      running = true;
      const body = await res.json().catch(() => ({}));
      mode = body?.mode || (body?.yolo_ready ? "yolo_som" : "vlm_direct");
    }
  } catch {
    running = false;
  }
  return {
    enabled,
    running,
    starting: Boolean(startPromise && !running),
    pid: child?.pid ?? null,
    port: Number(url.port || 8000),
    url: url.origin,
    mode,
  };
}

export async function toggleOmniServer(enable) {
  const wantEnable = typeof enable === "boolean" ? enable : !(await getOmniStatus()).running;
  if (!wantEnable) {
    process.env.OMNIPARSER_ENABLED = "false";
    stopOmniServer();
    return { ...(await getOmniStatus()), ok: true };
  }
  process.env.OMNIPARSER_ENABLED = "true";
  const ok = await ensureOmniServer({ timeoutMs: 25_000 });
  const status = await getOmniStatus();
  return {
    ...status,
    ok: ok && status.running,
    ...(ok && status.running ? {} : { error: "Không khởi động được OmniParser server (kiểm tra Python / cổng 8000)." }),
  };
}
