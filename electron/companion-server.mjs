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

// AUDIT-COMP-02 FIX: Prevent Brute-Force DoS on WebSocket token
const TOKEN_FAILURE_WINDOW_MS = 60000;
const MAX_TOKEN_FAILURES = 10;
const tokenFailuresByIp = new Map();

function isTokenBruteForceLimited(ip) {
  const now = Date.now();
  const record = tokenFailuresByIp.get(ip) || { count: 0, firstFail: now };
  if (now - record.firstFail > TOKEN_FAILURE_WINDOW_MS) {
    record.count = 1;
    record.firstFail = now;
  } else {
    record.count++;
  }
  tokenFailuresByIp.set(ip, record);
  return record.count > MAX_TOKEN_FAILURES;
}

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
    console.log("[Companion] Starting ngrok on port 8080...");
    try {
      ngrokWsTunnelUrl = await ngrok.connect({ addr: 8080, proto: 'http' });
    } catch (connectErr) {
      console.warn("[Companion] ngrok.connect threw an error, checking if tunnel actually exists...", connectErr.message);
      // Fallback: If ngrok retried internally and threw 'already exists', the tunnel is actually there.
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
        throw connectErr;
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

// AUDIT-COMP-B FIX (sample rate mismatch / rè, noise):
// Bản cũ chỉ nhìn 4 byte đầu có phải "RIFF" không rồi CẮT CỨNG 44 byte, sau
// đó main.mjs gửi buffer đó vào Gemini với mimeType cứng "audio/pcm;rate=16000"
// — bất kể file WAV thật sự được ghi ở sample rate nào, hay thậm chí buffer
// đó CÓ PHẢI PCM tuyến tính hay không.
//
// Rủi ro thật: `Audio.AndroidOutputFormat.DEFAULT` trong iris-companion/App.js
// (đường Expo Go cũ) không đảm bảo sinh ra RIFF/WAV PCM 16kHz thật trên mọi
// máy Android — nhiều máy sẽ ra container khác (vd AMR/3GP ép 8kHz) dù code
// yêu cầu extension '.wav'. Khi đó buffer không bắt đầu bằng "RIFF" nên hàm
// cũ không cắt gì cả và đẩy thẳng dữ liệu KHÔNG PHẢI PCM vào Gemini như thể
// nó là PCM 16kHz -> ra tiếng rè/nhiễu hoặc im lặng.
//
// Sửa: đọc đúng các trường trong header WAV chuẩn (audioFormat, numChannels,
// sampleRate, bitsPerSample) thay vì đoán mù, tìm đúng chunk "fmt "/"data"
// (không giả định cố định offset 44 vì có máy chèn thêm chunk khác trước).
// Trả về `{ pcm, sampleRate, valid }` để tầng gọi biết:
//   - sampleRate THẬT của chunk này (không còn giả định cứng 16000)
//   - valid=false nếu không phải RIFF/WAVE hoặc không phải PCM tuyến tính
//     16-bit mono/stereo — tầng gọi nên DROP chunk này thay vì gửi rác vào
//     Gemini (im lặng 1 chunk lỗi tốt hơn nhiều so với 1 chunk nhiễu).
function stripWavHeader(buffer) {
  const FALLBACK_SAMPLE_RATE = 16000;

  if (buffer.length <= 44 || buffer.slice(0, 4).toString('ascii') !== 'RIFF' || buffer.slice(8, 12).toString('ascii') !== 'WAVE') {
    // Không phải RIFF/WAVE hợp lệ (vd Android trả về container khác dù đặt
    // tên .wav). Không có header đáng tin để đọc sampleRate -> đánh dấu
    // invalid để tầng gọi có thể chọn drop thay vì gửi rác.
    return { pcm: buffer, sampleRate: FALLBACK_SAMPLE_RATE, valid: false };
  }

  // Tìm chunk "fmt " thay vì giả định luôn nằm ở offset 12 — một số bộ ghi âm
  // (đặc biệt trên Android) chèn thêm chunk khác (vd "JUNK", "LIST") trước
  // "fmt ", nên không thể tin cứng là header luôn đúng 44 byte.
  let offset = 12;
  let fmtFound = false;
  let audioFormat = 0, numChannels = 0, sampleRate = FALLBACK_SAMPLE_RATE, bitsPerSample = 0;
  let dataOffset = -1;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.slice(offset, offset + 4).toString('ascii');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkBodyStart = offset + 8;

    if (chunkId === 'fmt ' && chunkBodyStart + 16 <= buffer.length) {
      audioFormat = buffer.readUInt16LE(chunkBodyStart);
      numChannels = buffer.readUInt16LE(chunkBodyStart + 2);
      sampleRate = buffer.readUInt32LE(chunkBodyStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkBodyStart + 14);
      fmtFound = true;
    } else if (chunkId === 'data') {
      dataOffset = chunkBodyStart;
      break; // "data" luôn là chunk audio thật sự -> dừng ở đây
    }

    offset = chunkBodyStart + chunkSize + (chunkSize % 2); // chunk được pad chẵn byte
  }

  const isLinearPcm = audioFormat === 1 && bitsPerSample === 16 && (numChannels === 1 || numChannels === 2);

  if (!fmtFound || dataOffset === -1 || !isLinearPcm) {
    // Có RIFF/WAVE header nhưng không phải PCM 16-bit ta mong đợi (vd bị nén
    // AMR/ADPCM) -> không an toàn để đẩy thẳng vào Gemini như PCM.
    return { pcm: buffer.slice(Math.max(dataOffset, 44)), sampleRate, valid: false };
  }

  return { pcm: buffer.slice(dataOffset), sampleRate, valid: true };
}

export function sendSignalToPhone(data) {
  if (activeConnection && activeConnection.readyState === 1) {
    activeConnection.send(JSON.stringify(data));
  }
}

/**
 * Khởi tạo WebSocket server trên cổng 8080.
 *
 * @param {Function} emitEvent  — gửi log event ra renderer
 * @param {Function} sendAudioChunk — chuyển PCM buffer vào Gemini Live.
 *   AUDIT-COMP-B: nay nhận thêm tham số thứ 2 (sampleRate) đọc thật từ header
 *   WAV của chunk, không còn giả định cứng 16000Hz.
 * @param {object}   mainWindow — BrowserWindow để gửi frame ra renderer (hiển thị UI)
 * @param {Function} [sendFrameToGemini] — nếu có, gửi base64 JPEG frame trực tiếp vào Gemini Live
 */
export function startCompanionServer(emitEvent, sendAudioChunk, mainWindow, sendFrameToGemini) {
  if (wss) return;

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

  // Bypass ngrok crash on Windows Native
  // startNgrokTunnel(emitEvent);

  wss.on('connection', (ws, req) => {
    // ── SECURITY FIX: Authenticate token ──────────────────────────────
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const remoteIp = req.socket?.remoteAddress || 'unknown';

    if (url.searchParams.get('token') !== wsToken) {
      if (isTokenBruteForceLimited(remoteIp)) {
        emitEvent({ type: "log", level: "warn", message: `Companion: too many invalid-token attempts from ${remoteIp} — dropping.` });
        ws.terminate();
        return;
      }
      emitEvent({ type: "log", level: "warn", message: "Companion: connection rejected (invalid token)." });
      ws.close(4001, "Invalid token");
      return;
    }
    // Kết nối hợp lệ — xoá lịch sử thử sai của IP này (đỡ giữ state vô ích).
    tokenFailuresByIp.delete(remoteIp);

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
          if (["peer-ready", "offer", "answer", "ice", "control", "peer-left"].includes(parsed.type)) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("companion:webrtc-signal", parsed);
            }
            return;
          }

          // BUG-COMP-LEGACY-FRAME FIX: app Expo Go cũ (iris-companion/App.js)
          // chưa dùng RTCPeerConnection thật — nó vẫn gửi từng frame JPEG rời
          // rạc qua JSON { type: 'frame', data: base64 }. Trước đây nhánh
          // này không được xử lý gì cả nên frame bị lặng lẽ drop, khiến
          // camera Companion "kết nối được nhưng không có hình". Khôi phục:
          // đẩy frame vào Gemini Live (vision) VÀ phát lại cho renderer qua
          // "companion:frame" để CompanionVideo.tsx (PiP Alt+C) hiển thị ở
          // nhánh dự phòng Expo Go (khi chưa có luồng WebRTC thật).
          if (parsed.type === 'frame' && typeof parsed.data === 'string') {
            if (typeof sendFrameToGemini === 'function') sendFrameToGemini(parsed.data);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("companion:frame", parsed.data);
            }
          }
        } else {
          // BUG-COMP-LEGACY-AUDIO FIX: nhánh binary trước đây không tồn tại
          // -> mọi audio chunk (PCM 16kHz bọc header WAV) từ app Expo Go gửi
          // lên đều bị bỏ qua trong im lặng, khiến mic điện thoại "kết nối
          // nhưng không có tiếng". Khôi phục: bóc header WAV (nếu có) rồi
          // đẩy buffer PCM thẳng vào Gemini Live.
          //
          // AUDIT-COMP-B FIX: dùng sampleRate ĐỌC ĐƯỢC từ header thay vì
          // giả định cứng 16000, và DROP chunk nếu không phải PCM tuyến tính
          // hợp lệ — tránh gửi dữ liệu rác (vd container nén trên 1 số máy
          // Android) vào Gemini như thể là PCM sạch, nguyên nhân gây rè/nhiễu.
          const { pcm, sampleRate, valid } = stripWavHeader(message);
          if (!valid) {
            emitEvent({
              type: "log",
              level: "warn",
              message: "Companion: audio chunk không phải PCM 16-bit hợp lệ (WAV header thiếu/khác định dạng) — đã bỏ qua để tránh gây nhiễu, kiểm tra cấu hình ghi âm phía điện thoại.",
            });
            return;
          }
          sendAudioChunk(pcm, sampleRate);
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

export function stopCompanionServer() {
  // ── BUG-COMP-11 FIX: heartbeat interval must be cleared or it keeps
  // running (and keeps a reference to the closed `wss`) forever, leaking
  // a timer every start/stop cycle.
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  tokenFailuresByIp.clear();
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
    // Best-effort, non-blocking — don't hold up app quit on tunnel teardown.
    import('ngrok')
      .then(({ default: ngrok }) => ngrok.disconnect())
      .catch(() => { /* ngrok not installed or already gone — nothing to clean up */ })
      .finally(() => {
        ngrokConnected = false;
        ngrokWsTunnelUrl = null;
      });
  }
}
