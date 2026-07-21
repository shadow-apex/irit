import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let wss = null;
let httpServer = null;
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

    // ── BUG-COMP-13 FIX: `ngrok.kill()` kills the ngrok *binary process*
    // machine-wide, not just tunnels opened by this app. If the user has
    // any other ngrok tunnel running (another project, another tool), it
    // gets killed too as a side effect of just opening the companion.
    // We only need this call to clean up a *zombie tunnel from our own
    // previous run* (e.g. after a crash that skipped stopCompanionServer).
    // So only do it if we know we've started a tunnel before in this
    // process; skip it on a clean first start.
    if (hasStartedNgrokBefore) {
      try { await ngrok.kill(); } catch (e) {}
    }
    hasStartedNgrokBefore = true;

    console.log("[Companion] Starting ngrok on port 8080...");
    ngrokWsTunnelUrl = await ngrok.connect({ addr: 8080, proto: 'http' });
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

// WAV file header is typically 44 bytes for standard PCM.
// Strip it so only raw PCM data is forwarded to Gemini Live (audio/pcm;rate=16000).
function stripWavHeader(buffer) {
  if (buffer.length > 44 && buffer.slice(0, 4).toString('ascii') === 'RIFF') {
    return buffer.slice(44);
  }
  return buffer;
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

  // Generate a random secure token for this session
  wsToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  httpServer = createServer((req, res) => {
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
  });

  wss = new WebSocketServer({ server: httpServer });
  
  httpServer.listen(8080, () => {
    emitEvent({ type: "log", level: "info", message: "Companion HTTP/WS Server started on port 8080" });
  });

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

    // ── BUG-COMP-10 FIX: message-type detection ─────────────────────────
    // The old code guessed "is this JSON?" by checking whether the first
    // byte of a Buffer equals 123 (ascii '{'). Raw PCM audio bytes are
    // effectively random, so ~1/256 audio chunks (~every 65s of talking)
    // start with byte 0x7B, get misread as JSON, throw inside JSON.parse,
    // and get silently swallowed by the catch block below — dropping that
    // chunk of audio with no log. `ws` already tells us via the `isBinary`
    // flag whether a frame is text or binary; use that instead of guessing.
    ws.on('message', (message, isBinary) => {
      try {
        if (!isBinary) {
          // JSON message: video frame OR control signals
          const parsed = JSON.parse(message.toString());

          if (parsed.type === "frame" && parsed.data) {
            // ── BUG-COMP-02 FIX: Forward frame to Gemini Live directly ────
            if (typeof sendFrameToGemini === 'function') {
              sendFrameToGemini(parsed.data); // base64 JPEG → Gemini Live
            }
            // Also forward to renderer for UI display (companion:frame listener in preload)
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("companion:frame", parsed.data);
            }
            // ─────────────────────────────────────────────────────────────
          }
        } else {
          // ── BUG-COMP-07 FIX: Strip WAV header before sending PCM to Gemini
          const pcmBuffer = stripWavHeader(message);
          if (pcmBuffer.length > 0) {
            sendAudioChunk(pcmBuffer);
          }
          // ─────────────────────────────────────────────────────────────────
        }
      } catch (err) {
        emitEvent({ type: "log", level: "warn", message: `Companion: malformed message ignored: ${err.message}` });
      }
    });
    // ─────────────────────────────────────────────────────────────────────

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
