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
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { unpackedRepoRoot, pythonBin } from "./paths.mjs";
import { killTree } from "./process-utils.mjs";

const generatedToken = crypto.randomBytes(24).toString("hex");
let child = null;
let startPromise = null;
let logger = (level, msg) => console[level === "error" ? "error" : "log"](`[omni] ${msg}`);

export function setOmniLogger(fn) {
  if (typeof fn === "function") logger = fn;
}

export function omniToken() {
  return String(process.env.IRIS_OMNI_TOKEN || "").trim() || generatedToken;
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

function spawnServer(url) {
  const dir = path.join(unpackedRepoRoot(), "reponew", "toado");
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
      PYTHONIOENCODING: "utf-8",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32", // để killTree dừng được cả nhóm trên POSIX
  });
  const tail = (d) => {
    const line = String(d).trim().split("\n").pop();
    if (line) logger("info", line.slice(0, 200));
  };
  proc.stdout.on("data", tail);
  proc.stderr.on("data", tail);
  proc.on("error", (e) => {
    logger("error", `không chạy được api_server.py: ${e.message}`);
    if (child === proc) child = null;
  });
  proc.on("exit", (code) => {
    if (code) logger("error", `OmniParser thoát (code ${code}). Kiểm tra thư viện Python trong reponew/toado/requirements.txt.`);
    if (child === proc) child = null;
  });
  return proc;
}

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
      if (!child) child = spawnServer(url);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!child) return false; // tiến trình đã chết
        if (await healthy(origin)) return true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      logger("error", `OmniParser chưa sẵn sàng sau ${Math.round(timeoutMs / 1000)}s`);
      return false;
    } finally {
      startPromise = null;
    }
  })();
  return startPromise;
}

export function stopOmniServer() {
  if (!child) return;
  const c = child;
  child = null;
  killTree(c);
}
