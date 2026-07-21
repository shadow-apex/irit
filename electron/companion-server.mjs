import { WebSocketServer } from 'ws';

let wss = null;
let activeConnection = null;

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

  wss = new WebSocketServer({ port: 8080 });
  emitEvent({ type: "log", level: "info", message: "Companion WebSocket Server started on port 8080" });

  wss.on('connection', (ws) => {
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

    ws.on('message', (message) => {
      try {
        // JSON message: video frame OR control signals
        if (typeof message === "string" || (message instanceof Buffer && message[0] === 123)) {
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
        } else if (message instanceof Buffer) {
          // ── BUG-COMP-07 FIX: Strip WAV header before sending PCM to Gemini
          const pcmBuffer = stripWavHeader(message);
          if (pcmBuffer.length > 0) {
            sendAudioChunk(pcmBuffer);
          }
          // ─────────────────────────────────────────────────────────────────
        }
      } catch (err) {
        // Ignore malformed messages
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
}

export function stopCompanionServer() {
  if (activeConnection) {
    try { activeConnection.close(); } catch {}
    activeConnection = null;
  }
  if (wss) {
    wss.close();
    wss = null;
  }
}
