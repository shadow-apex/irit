import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_ROSTER } from "./main/agent-roster.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// S-09 — Web dashboard
//
// Dashboard này cho phép gửi task tới Claude (chạy `--permission-mode
// bypassPermissions`) và bơm văn bản vào phiên giọng nói => ai qua được lớp xác
// thực là điều khiển được PC. Vì vậy:
//   * MẶC ĐỊNH TẮT — chỉ chạy khi IRIS_WEB_DASHBOARD=1.
//   * Bind 127.0.0.1 mặc định; muốn LAN phải đặt IRIS_WEB_BIND=0.0.0.0 (log cảnh báo to).
//   * KHÔNG có mật khẩu mặc định; từ chối khởi động nếu WEB_PASSWORD rỗng,
//     bằng "iris123" hoặc ngắn hơn MIN_PASSWORD_LENGTH ký tự.
//   * Mật khẩu chỉ nhận qua header `x-password` (không qua query string).
//   * So sánh hằng-thời-gian trên hash SHA-256; chống dò: 5 lần sai/phút/IP
//     => khoá 15 phút.
// ---------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_TASK_LENGTH = 4000;
export const MAX_TEXT_LENGTH = 4000;
const FAIL_LIMIT = 5;
const FAIL_WINDOW_MS = 60_000;
const LOCK_MS = 15 * 60_000;
const LEGACY_DEFAULT_PASSWORD = "iris123";

/** @returns {{ok:boolean, reason?:string}} */
export function validateWebPassword(pw) {
  const v = typeof pw === "string" ? pw : "";
  if (!v) return { ok: false, reason: "WEB_PASSWORD chưa được đặt" };
  if (v.trim().toLowerCase() === LEGACY_DEFAULT_PASSWORD) {
    return { ok: false, reason: "WEB_PASSWORD không được là mật khẩu mặc định cũ" };
  }
  if (v.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `WEB_PASSWORD phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự` };
  }
  return { ok: true };
}

const sha256 = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest();

/** So sánh hằng-thời-gian: hash hai phía rồi timingSafeEqual (độ dài cố định 32 byte). */
export function passwordsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Tạo Express app (chưa listen) — tách riêng để test được.
 * @param {object} callbacks
 * @param {string} password mật khẩu đã được validateWebPassword() chấp nhận
 */
export function createWebApp(callbacks, password) {
  const app = express();
  app.disable("x-powered-by");

  let webClients = [];
  /** @type {Map<string,{fails:number[], lockedUntil:number}>} */
  const attempts = new Map();

  const ipOf = (req) => req.socket?.remoteAddress || "unknown";

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Lớp xác thực đặt TRƯỚC mọi route /api, TRƯỚC body parser và TRƯỚC express.static
  // (client chưa đăng nhập không thể bắt server parse body).
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const ip = ipOf(req);
    const now = Date.now();
    const rec = attempts.get(ip) || { fails: [], lockedUntil: 0 };

    if (rec.lockedUntil > now) {
      res.setHeader("Retry-After", String(Math.ceil((rec.lockedUntil - now) / 1000)));
      return res.status(429).json({ error: "Quá nhiều lần thử sai. Thử lại sau." });
    }

    // Chỉ header — KHÔNG đọc req.query.password.
    const provided = req.headers["x-password"];
    if (typeof provided === "string" && passwordsMatch(provided, password)) {
      attempts.delete(ip);
      return next();
    }

    rec.fails = rec.fails.filter((t) => now - t < FAIL_WINDOW_MS);
    rec.fails.push(now);
    if (rec.fails.length >= FAIL_LIMIT) {
      rec.lockedUntil = now + LOCK_MS;
      rec.fails = [];
      callbacks.log?.("warn", `[web] khoá ${ip} 15 phút do nhập sai mật khẩu nhiều lần`);
    }
    attempts.set(ip, rec);
    return res.status(401).json({ error: "Unauthorized. Sai mật khẩu!" });
  });

  app.use("/api", express.json({ limit: "32kb" }));

  // Trang tĩnh (chỉ là giao diện đăng nhập, không chứa dữ liệu) — đặt SAU /api auth.
  app.use(express.static(path.join(__dirname, "web-public")));

  app.post("/api/task", (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (!task) return res.status(400).json({ error: "Missing task content" });
    if (task.length > MAX_TASK_LENGTH) {
      return res.status(400).json({ error: `Task quá dài (tối đa ${MAX_TASK_LENGTH} ký tự)` });
    }
    const agent = body.agent == null ? "dev" : body.agent;
    if (typeof agent !== "string" || !AGENT_ROSTER.includes(agent)) {
      return res.status(400).json({ error: "Agent không hợp lệ" });
    }
    callbacks.submitTask?.({ task, agent });
    res.json({ success: true, message: "Task submitted successfully" });
  });

  app.post("/api/gemini", (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Missing text" });
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Text quá dài (tối đa ${MAX_TEXT_LENGTH} ký tự)` });
    }
    callbacks.sendToGemini?.(text);
    res.json({ success: true, message: "Message sent to Gemini" });
  });

  app.get("/api/status", (_req, res) => {
    res.json({ status: callbacks.getStatus?.() || "Unknown" });
  });

  // Server-Sent Events — client dùng fetch() + header x-password (EventSource
  // không gắn được header nên trước đây phải để mật khẩu trên URL).
  app.get("/api/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
    });
    webClients.push(res);
    res.write(`data: ${JSON.stringify({ text: "✅ Đã kết nối với Iris Core!" })}\n\n`);
    req.on("close", () => {
      webClients = webClients.filter((client) => client !== res);
    });
  });

  // Lỗi parse/kích thước body => JSON gọn, không rò stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status) || 400;
    res.status(status >= 400 && status < 500 ? status : 500).json({ error: "Yêu cầu không hợp lệ" });
  });

  const broadcast = (text) => {
    const data = `data: ${JSON.stringify({ text })}\n\n`;
    for (const client of webClients) {
      try {
        client.write(data);
      } catch {
        /* client đã đóng */
      }
    }
  };
  const closeClients = () => {
    for (const c of webClients) {
      try {
        c.end();
      } catch {
        /* ignore */
      }
    }
    webClients = [];
  };

  return { app, broadcast, closeClients };
}

let activeServer = null;

/**
 * Khởi động Web Dashboard — hoặc không làm gì nếu điều kiện an toàn không đạt.
 * @param {Object} callbacks
 * @param {Function} callbacks.submitTask - ({task, agent}) => void
 * @param {Function} callbacks.sendToGemini - (text) => void
 * @param {Function} callbacks.getStatus - () => string
 * @param {Function} callbacks.log - (level, msg) => void
 * @param {Record<string,string|undefined>} [env] mặc định process.env (tham số để test)
 * @returns {Function} sendWebMessage (no-op nếu dashboard không chạy). Có thêm
 *   thuộc tính: `.enabled`, `.reason`, `.ready` (Promise), `.server`.
 */
export function initWebServer(callbacks, env = process.env) {
  const noop = () => {};
  noop.enabled = false;
  noop.ready = Promise.resolve(false);

  if (String(env.IRIS_WEB_DASHBOARD || "").trim() !== "1") {
    noop.reason = "IRIS_WEB_DASHBOARD != 1 (mặc định tắt)";
    return noop;
  }

  const pw = validateWebPassword(env.WEB_PASSWORD);
  if (!pw.ok) {
    noop.reason = pw.reason;
    callbacks.log?.(
      "error",
      `[web] Web Dashboard KHÔNG khởi động: ${pw.reason}. Đặt WEB_PASSWORD >= ${MIN_PASSWORD_LENGTH} ký tự (khác "iris123").`,
    );
    return noop;
  }

  const host = String(env.IRIS_WEB_BIND || "127.0.0.1").trim() || "127.0.0.1";
  const portNum = Number(env.WEB_PORT ?? 3000);
  const port = Number.isInteger(portNum) && portNum >= 0 && portNum < 65536 ? portNum : 3000;

  const { app, broadcast, closeClients } = createWebApp(callbacks, env.WEB_PASSWORD);

  const sendWebMessage = (text) => broadcast(String(text ?? ""));
  sendWebMessage.enabled = true;

  sendWebMessage.ready = new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      const addr = server.address();
      const shown = typeof addr === "object" && addr ? addr.port : port;
      callbacks.log?.("info", `[web] Web Dashboard chạy tại http://${host}:${shown}`);
      if (!isLoopback(host)) {
        callbacks.log?.(
          "warn",
          `[web] CẢNH BÁO: dashboard đang mở cho toàn mạng (${host}). Bất kỳ ai biết WEB_PASSWORD đều điều khiển được máy này.`,
        );
      }
      resolve(true);
    });
    server.on("error", (err) => {
      callbacks.log?.("error", `[web] Không thể khởi động Web Server: ${err.message}`);
      sendWebMessage.enabled = false;
      resolve(false);
    });
    sendWebMessage.server = server;
    activeServer = { server, closeClients };
  });

  return sendWebMessage;
}

/** Đóng dashboard (gọi từ cleanup khi thoát app). */
export function stopWebServer() {
  if (!activeServer) return;
  const { server, closeClients } = activeServer;
  activeServer = null;
  try {
    closeClients();
    server.close();
    server.closeAllConnections?.();
  } catch {
    /* ignore */
  }
}
