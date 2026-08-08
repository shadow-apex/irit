import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// HTTPS_CAM FIX: Safari trên iOS chỉ cho phép `getUserMedia` (mở camera) trên
// "secure context" — tức HTTPS hoặc localhost. Vì companion server chạy trên
// LAN IP (http://<lan-ip>:8080), Safari coi đó là insecure origin và chặn
// camera của điện thoại khi dùng thẻ WebRTC (Alt+C / Alt+Q). Cặp cert/key đã
// được tạo sẵn bằng mkcert (self-signed, trust local) tại PHONE_CAMERA/cert/.
const CERT_DIR = path.join(__dirname, '..', 'PHONE_CAMERA', 'cert');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const HTTPS_PORT = 8444;

let wss = null;
let httpServer = null;
let httpsServer = null;
let activeConnection = null;
let heartbeatInterval = null;

// FIX-COMP-STALE-WINDOW: `mainWindow` trước đây chỉ được truyền vào MỘT LẦN
// làm tham số của startCompanionServer() và bị "đóng băng" trong closure của
// wss.on('connection', ...). Nhưng mainWindow trong main.mjs có thể bị đóng
// và TẠO LẠI hoàn toàn (BrowserWindow mới) — ví dụ: người dùng bấm nút đóng
// cửa sổ (sự kiện 'closed' set mainWindow = null), rồi mở lại qua Tray "Show
// Deck", click icon Dock (macOS), hoặc app.on('activate'). Vì
// startCompanionServer() chỉ chạy đúng 1 lần (guard `if (wss) return;` ở
// trên), companion-server.mjs không bao giờ biết cửa sổ mới này tồn tại —
// nó vẫn giữ tham chiếu tới cửa sổ CŨ đã bị destroy. Kết quả: sau lần đóng/mở
// lại cửa sổ đầu tiên, `mainWindow.isDestroyed()` luôn trả về true, relay
// SDP/ICE từ điện thoại bị rớt vĩnh viễn dù server, WebSocket, ICE đều OK.
// Sửa bằng cách tách `mainWindow` ra khỏi tham số hàm, lưu ở biến module-level
// có thể cập nhật bất cứ lúc nào qua setCompanionMainWindow() — main.mjs gọi
// hàm này mỗi khi tạo/hủy mainWindow.
let currentMainWindow = null;

export function setCompanionMainWindow(win) {
  currentMainWindow = win;
}

// BUG-COMP-08 FIX: `expo start --tunnel` only tunnels port 8081 (the Metro
// bundler that serves the JS to Expo Go). It never touches port 8080, which
// is THIS server — the raw WebSocket carrying the actual camera/audio
// stream. Without a tunnel of its own, the companion app was always forced
// to reach port 8080 over `ws://<LAN IP>:8080`, i.e. same-WiFi only, no
// matter how the phone got the app itself. This opens a second, independent
// ngrok tunnel for port 8080 so the live stream can also travel over the
// internet — the desktop UI can display/copy this URL for the user to paste
// into the companion app instead of a LAN IP.
let ngrokWsTunnelUrl = null;
let ngrokConnected = false;
let wsToken = null;
let hasStartedNgrokBefore = false;

// `ngrok` is an optional dependency — only required if the user actually
// wants remote (non-LAN) streaming. Import lazily so a machine without it
// installed doesn't crash the whole companion server, just skips the tunnel.
async function startNgrokTunnel(emitEvent) {
  let ngrok;
  try {
    ({ default: ngrok } = await import('ngrok'));
  } catch (e) {
    console.error("[Companion] Failed to import ngrok:", e);
    emitEvent({
      type: "log",
      level: "warn",
      message: "Companion: 'ngrok' package not installed — camera/audio stream will only work over LAN (run `npm install ngrok` to enable remote streaming).",
    });
    return;
  }

  try {
    let authtoken = process.env.IRIS_NGROK_AUTHTOKEN || process.env.NGROK_AUTHTOKEN;
    
    // Fallback: manually parse .env if process.env is missing the token (due to Windows setx without restart)
    if (!authtoken) {
      try {
        const envPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf8');
          const match = envContent.match(/^IRIS_NGROK_AUTHTOKEN\s*=\s*(.+)$/m);
          if (match && match[1]) {
            authtoken = match[1].trim();
          }
        }
      } catch (err) {
        console.error("[Companion] Failed to read .env:", err);
      }
    }

    console.log("[Companion] Using ngrok authtoken:", authtoken ? "FOUND" : "MISSING");

    if (authtoken) {
      await ngrok.authtoken(authtoken);
    } else {
      emitEvent({
        type: "log",
        level: "warn",
        message: "Companion: IRIS_NGROK_AUTHTOKEN is not set — recent ngrok versions require a free authtoken (https://dashboard.ngrok.com) or the tunnel will fail to start.",
      });
    }
    // BUGFIX-COMP-NGROK-01: "tunnel already exists" happens when an ngrok
    // agent from a *previous* run is still alive (e.g. app was force-closed,
    // or the previous stopCompanionServer() call didn't finish its
    // disconnect before the process exited — see stopCompanionServer()
    // below for the matching fix). Before every connect attempt, proactively
    // kill any local agent this ngrok SDK instance might already be
    // tracking. This is safe/idempotent — if nothing is running it just
    // resolves immediately.
    try {
      await ngrok.kill();
    } catch { /* nothing running — fine */ }

    console.log("[Companion] Starting ngrok on port 8080...");
    try {
      ngrokWsTunnelUrl = await ngrok.connect({ addr: 8080, proto: 'http' });
    } catch (connectErr) {
      console.warn("[Companion] ngrok.connect threw an error, checking if tunnel actually exists...", connectErr.message);
      // Fallback #1: If ngrok retried internally and threw 'already exists', the tunnel is actually there.
      // We can fetch the running tunnels from its local API.
      try {
        const res = await fetch('http://127.0.0.1:4040/api/tunnels');
        const data = await res.json();
        if (data && data.tunnels && data.tunnels.length > 0) {
          const tunnel8080 = data.tunnels.find(t => t.config && t.config.addr && t.config.addr.includes('8080'));
          ngrokWsTunnelUrl = tunnel8080 ? tunnel8080.public_url : data.tunnels[0].public_url;
          console.log("[Companion] Recovered ngrok URL from API:", ngrokWsTunnelUrl);
        } else {
          throw connectErr;
        }
      } catch (fallbackErr) {
        // Fallback #2: the stale agent might be a completely separate
        // process (different local API port, or one `ngrok.kill()` above
        // couldn't reach), so the API recovery above found nothing. Force-
        // kill again and retry the connect once more before giving up.
        console.warn("[Companion] Could not recover existing tunnel, force-killing and retrying once...");
        try {
          await ngrok.kill();
          await new Promise((r) => setTimeout(r, 1000));
          ngrokWsTunnelUrl = await ngrok.connect({ addr: 8080, proto: 'http' });
        } catch (retryErr) {
          throw retryErr;
        }
      }
    }
    
    console.log("[Companion] ngrok raw URL:", ngrokWsTunnelUrl);
    ngrokWsTunnelUrl = ngrokWsTunnelUrl.replace(/^https:\/\//, 'wss://');
    ngrokConnected = true;
    console.log("[Companion] ngrok tunnel ready at", ngrokWsTunnelUrl);
    emitEvent({ type: "log", level: "info", message: `Companion: camera/audio ngrok tunnel ready at ${ngrokWsTunnelUrl}` });
  } catch (err) {
    console.error("[Companion] Ngrok error:", err);
    ngrokWsTunnelUrl = null;
    ngrokConnected = false;
    emitEvent({ type: "log", level: "error", message: `Companion: failed to start ngrok tunnel for port 8080: ${err.message}` });
  }
}

// Read by the companion:get-ws-tunnel IPC handler (main.mjs) so the desktop
// UI can show/copy it for the user to paste into the phone app.
export function getCompanionWsTunnel() {
  return ngrokWsTunnelUrl;
}

export function getCompanionWsToken() {
  return wsToken;
}

function stripWavHeader(buffer) {
  if (buffer.length > 44 && buffer.slice(0, 4).toString('ascii') === 'RIFF') {
    return buffer.slice(44);
  }
  return buffer;
}

export function sendSignalToPhone(data) {
  // DEBUG-COMP-RELAY-01 (cont.): log chiều PC -> phone (answer, ice, mic-toggle...)
  // để biết message có thực sự gửi đi được hay bị rớt vì activeConnection null/closed
  // (ví dụ phone đã disconnect nhưng PC chưa kịp nhận 'peer-left').
  const canSend = !!(activeConnection && activeConnection.readyState === 1);
  console.log(
    `[Companion][Relay] -> phone: type=${data?.type} | connection=${canSend ? 'OPEN, sent' : `NOT OPEN (readyState=${activeConnection?.readyState ?? 'null'}) -> DROPPED!`}`
  );
  if (canSend) {
    activeConnection.send(JSON.stringify(data));
  }
}

/**
 * Khởi tạo WebSocket server trên cổng 8080.
 *
 * @param {Function} emitEvent  — gửi log event ra renderer
 * @param {Function} sendAudioChunk — chuyển PCM buffer vào Gemini Live
 * @param {object}   mainWindow — BrowserWindow để gửi frame ra renderer (hiển thị UI)
 * @param {Function} [sendFrameToGemini] — nếu có, gửi base64 JPEG frame trực tiếp vào Gemini Live
 */
export function startCompanionServer(emitEvent, sendAudioChunk, mainWindow, sendFrameToGemini) {
  if (wss) return;

  // Khởi tạo tham chiếu ban đầu — các lần cửa sổ bị đóng/tạo lại sau đó
  // main.mjs sẽ gọi setCompanionMainWindow() để cập nhật currentMainWindow,
  // xem giải thích FIX-COMP-STALE-WINDOW ở khai báo biến phía trên.
  currentMainWindow = mainWindow;

  // AUDIT-COMP-01 FIX: Math.random() KHÔNG phải CSPRNG — nó dùng thuật toán
  // xorshift/PRNG thường có thể dự đoán được nếu biết vài output trước đó
  // (V8 dùng xorshift128+). Với 1 token dùng để xác thực kết nối điều khiển
  // camera/mic từ xa (qua ngrok, tức là public internet), phải dùng CSPRNG
  // thật sự. crypto.randomBytes(32) cho 256 bit entropy, encode hex để an
  // toàn khi nhét vào query string URL.
  wsToken = crypto.randomBytes(32).toString('hex');

  // Shared request handler for both HTTP (8080) and HTTPS (8444) servers.
  const requestHandler = (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Serve Web Companion HTML
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/companion.html')) {
      const htmlPath = path.join(__dirname, 'companion.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(htmlPath));
      } else {
        res.writeHead(404);
        res.end('Web Companion not found.');
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  };

  httpServer = createServer(requestHandler);

  // HTTPS_CAM FIX: `new WebSocketServer({ server })` only binds `upgrade` to
  // ONE http(s).Server instance. Since we now run two servers (HTTP 8080 +
  // HTTPS 8444) sharing the same signaling logic, `wss` is created in
  // "noServer" mode and its 'upgrade' handling is wired manually to BOTH
  // servers below — so a WebRTC phone client connecting via wss://<ip>:8444
  // reaches the exact same `wss` instance (and `activeConnection`,
  // heartbeat, token auth, etc.) as one connecting via ws://<ip>:8080.
  wss = new WebSocketServer({ noServer: true });

  const handleUpgrade = (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  };
  httpServer.on('upgrade', handleUpgrade);

  // BUGFIX-COMP-PORT-01: `httpServer` (cổng 8080 — server THẬT sự phục vụ
  // Alt+C: companion.html + WebSocket signaling) trước đây không có handler
  // cho sự kiện 'error'. Nếu cổng 8080 đã bị chiếm bởi tiến trình khác —
  // phổ biến nhất là PHONE_CAMERA/server.js, được `npm run dev` khởi động
  // song song qua script "camera" (xem package.json) và tự bind
  // 127.0.0.1:8080 — thì `.listen(8080)` bên dưới ném ra 'error' (EADDRINUSE)
  // không ai bắt, Node coi đây là uncaught exception và có thể crash/treo
  // toàn bộ tiến trình Electron main. Kết quả nhìn từ UI: PiP Alt+C đứng mãi
  // ở "Đang chờ điện thoại kết nối...", không có ảnh, không có âm thanh, và
  // đôi khi cả app không phản hồi — mà không có thông báo lỗi rõ ràng nào.
  // Bắt lỗi ở đây để: (1) không crash cả app, (2) báo rõ nguyên nhân + cách
  // khắc phục ra log, và (3) người dùng có thể chỉ đơn giản tắt PHONE_CAMERA
  // đang chạy (hoặc bỏ script "camera" khỏi `npm run dev`) rồi thử lại.
  httpServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      emitEvent({
        type: "log",
        level: "error",
        message:
          "Companion: cổng 8080 đã bị chiếm bởi tiến trình khác (thường là PHONE_CAMERA/server.js chạy song song qua `npm run dev`). " +
          "Camera/mic điện thoại (Alt+C) sẽ KHÔNG hoạt động cho tới khi cổng 8080 được giải phóng — " +
          "hãy tắt tiến trình đang giữ cổng 8080 (hoặc bỏ script 'camera' khỏi npm run dev) rồi thử lại.",
      });
    } else {
      emitEvent({ type: "log", level: "error", message: `Companion HTTP Server error: ${err?.message}` });
    }
  });

  httpServer.listen(8080, () => {
    emitEvent({ type: "log", level: "info", message: "Companion HTTP/WS Server started on port 8080" });
  });

  // Try to bring up the HTTPS/WSS server on 8444 using the mkcert-issued
  // cert in PHONE_CAMERA/cert/. This is required for Safari on iOS to allow
  // getUserMedia() (camera) over the LAN — Safari treats plain HTTP on a LAN
  // IP as an insecure context and silently blocks camera access.
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    try {
      const httpsOptions = {
        cert: fs.readFileSync(CERT_PATH),
        key: fs.readFileSync(KEY_PATH),
      };
      httpsServer = createHttpsServer(httpsOptions, requestHandler);
      httpsServer.on('upgrade', handleUpgrade);
      httpsServer.on('error', (err) => {
        emitEvent({ type: "log", level: "error", message: `Companion HTTPS Server error: ${err.message}` });
      });
      httpsServer.listen(HTTPS_PORT, () => {
        emitEvent({ type: "log", level: "info", message: `Companion HTTPS/WSS Server started on port ${HTTPS_PORT}` });
      });
    } catch (err) {
      httpsServer = null;
      emitEvent({ type: "log", level: "error", message: `Companion: failed to start HTTPS server: ${err.message}` });
    }
  } else {
    emitEvent({
      type: "log",
      level: "warn",
      message: `Companion: cert.pem/key.pem not found in ${CERT_DIR} — HTTPS server on port ${HTTPS_PORT} was not started. iPhone Safari will block camera access without HTTPS (run mkcert to generate them).`,
    });
  }

  // Fire-and-forget: the LAN server is already usable while the tunnel comes up.
  startNgrokTunnel(emitEvent);

  wss.on('connection', (ws, req) => {
    // ── SECURITY FIX: Authenticate token ──────────────────────────────
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.searchParams.get('token') !== wsToken) {
      emitEvent({ type: "log", level: "warn", message: "Companion: connection rejected (invalid token)." });
      ws.close(4001, "Invalid token");
      return;
    }

    // ── BUG-COMP-03 FIX: Reject second connection ─────────────────────────
    if (activeConnection && activeConnection.readyState === activeConnection.OPEN) {
      emitEvent({ type: "log", level: "warn", message: "Companion: second connection rejected (already connected)." });
      ws.send(JSON.stringify({ type: "error", message: "Already connected to another client." }));
      ws.close(1008, "Already connected");
      return;
    }
    // ─────────────────────────────────────────────────────────────────────

    emitEvent({ type: "log", level: "info", message: "Mobile Companion App connected!" });
    activeConnection = ws;

    // ── BUG-COMP-09 FIX: heartbeat ──────────────────────────────────────
    // If the phone loses network abruptly (wifi drop, phone locked, app
    // killed) the underlying TCP socket may stay half-open for a long time,
    // especially when routed through ngrok. Without an application-level
    // heartbeat, `close` never fires promptly, `activeConnection` keeps
    // pointing at a dead socket, and the *same* phone reconnecting gets
    // rejected by the "already connected" guard above until the OS finally
    // times the old socket out. ping/pong every 15s + terminate() on a
    // missed pong fixes this.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // ─────────────────────────────────────────────────────────────────────

    ws.on('message', (message, isBinary) => {
      try {
        if (!isBinary) {
          const parsed = JSON.parse(message.toString());
          
          // Relay WebRTC signaling from Phone to Desktop Renderer
          // FEAT-COMP-CONTROL-01: 'iris-command' — điện thoại gửi lệnh
          // (gõ tay hoặc thoại-to-text ngay trên trình duyệt điện thoại) để
          // điều khiển Iris từ xa, đi chung đường relay với offer/ice/control
          // (không cần mở kênh WS mới, không cần WebRTC data channel).
          if (["peer-ready", "offer", "answer", "ice", "control", "peer-left", "iris-command"].includes(parsed.type)) {
            // DEBUG-COMP-RELAY-01: trước đây relay này hoàn toàn im lặng —
            // nếu mainWindow bị null/destroyed (ví dụ Vite HMR reload cửa sổ
            // trong `npm run dev`, hoặc user đóng cửa sổ chính) thì message
            // bị "nuốt" mà không có bất kỳ dấu vết nào trong log. Log rõ mỗi
            // message + kết quả relay (OK / DROPPED) để xác định ngay server
            // <-> renderer có thông hay không, tách biệt khỏi vấn đề ICE/TURN.
            const canRelay = !!(currentMainWindow && !currentMainWindow.isDestroyed());
            console.log(
              `[Companion][Relay] <- phone: type=${parsed.type}` +
              (parsed.type === 'ice' ? ` candidate=${(parsed.candidate?.candidate || '').match(/typ (\w+)/)?.[1] || 'n/a'}` : '') +
              ` | mainWindow=${canRelay ? 'OK, forwarding to renderer' : 'MISSING/DESTROYED -> DROPPED!'}`
            );
            if (canRelay) {
              currentMainWindow.webContents.send("companion:webrtc-signal", parsed);
            } else {
              emitEvent({
                type: "log",
                level: "error",
                message: `Companion: nhận được '${parsed.type}' từ điện thoại nhưng KHÔNG relay được vì mainWindow không tồn tại/đã bị destroy — mở lại cửa sổ Iris và thử kết nối lại.`,
              });
            }
          }
        }
      } catch (err) {
        emitEvent({ type: "log", level: "warn", message: `Companion: malformed message ignored: ${err.message}` });
      }
    });

    ws.on('close', () => {
      emitEvent({ type: "log", level: "info", message: "Mobile Companion App disconnected." });
      if (activeConnection === ws) activeConnection = null;
    });

    ws.on('error', (err) => {
      emitEvent({ type: "log", level: "error", message: `Companion WebSocket error: ${err.message}` });
    });
  });

  wss.on('error', (err) => {
    emitEvent({ type: "log", level: "error", message: `Companion Server failed to start: ${err.message}` });
  });

  // ── BUG-COMP-09 FIX (cont.): heartbeat sweep ──────────────────────────
  heartbeatInterval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        emitEvent({ type: "log", level: "warn", message: "Companion: terminating unresponsive connection (missed heartbeat)." });
        return ws.terminate(); // triggers 'close' -> frees activeConnection
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);
  // ─────────────────────────────────────────────────────────────────────
}

export async function stopCompanionServer() {
  // ── BUG-COMP-11 FIX: heartbeat interval must be cleared or it keeps
  // running (and keeps a reference to the closed `wss`) forever, leaking
  // a timer every start/stop cycle.
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (activeConnection) {
    try { activeConnection.close(); } catch {}
    activeConnection = null;
  }
  if (wss) {
    wss.close();
    wss = null;
  }
  // ── BUG-COMP-12 FIX: this was the main crash bug. `wss.close()` only
  // stops accepting new WebSocket upgrades — it does NOT release the port.
  // `httpServer` (the actual thing bound to :8080) was never closed, so
  // the next `startCompanionServer()` call did `httpServer.listen(8080)`
  // again on a fresh server while the old one was still bound
  // -> EADDRINUSE crash the 2nd time companion server was started/stopped
  // in the same Electron process.
  if (httpServer) {
    try { httpServer.close(); } catch {}
    httpServer = null;
  }
  // Same EADDRINUSE reasoning applies to the HTTPS server on 8444 — it must
  // also be closed explicitly, or the port stays bound on the next start.
  if (httpsServer) {
    try { httpsServer.close(); } catch {}
    httpsServer = null;
  }
  // ─────────────────────────────────────────────────────────────────────
  if (ngrokConnected) {
    // BUGFIX-COMP-NGROK-01 (cont.): `disconnect()` only closes the tunnel;
    // the local ngrok agent process kept running. If the app then exited
    // (Electron doesn't wait for un-awaited promises in before-quit) before
    // that agent shut down cleanly, ngrok's edge servers could still think
    // the tunnel was live on the next launch -> "tunnel already exists".
    // `kill()` fully terminates the local agent (calls disconnect() first
    // internally), and this is now awaited by the caller instead of being
    // fire-and-forget, so cleanup actually finishes before quit.
    try {
      const { default: ngrok } = await import('ngrok');
      await ngrok.kill();
    } catch {
      /* ngrok not installed or already gone — nothing to clean up */
    } finally {
      ngrokConnected = false;
      ngrokWsTunnelUrl = null;
    }
  }
}
