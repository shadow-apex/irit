import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let webClients = [];

/**
 * Initialize the Web Server Dashboard
 * @param {Object} callbacks 
 * @param {Function} callbacks.submitTask - (taskObj) => void
 * @param {Function} callbacks.sendToGemini - (text) => void
 * @param {Function} callbacks.getStatus - () => string
 * @param {Function} callbacks.log - (level, msg) => void
 * @returns {Function} sendWebMessage - A function to send text back to the Web UI via SSE
 */
export function initWebServer(callbacks) {
  const app = express();
  const port = process.env.WEB_PORT || 3000;
  const WEB_PASSWORD = process.env.WEB_PASSWORD || 'iris123'; // Default password

  app.use(express.json());
  
  // Static files (HTML/CSS/JS)
  app.use(express.static(path.join(__dirname, 'web-public')));

  // Simple authentication middleware for API
  app.use('/api', (req, res, next) => {
    const pass = req.headers['x-password'] || req.query.password;
    if (pass !== WEB_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized. Sai mật khẩu!' });
    }
    next();
  });

  // API to submit a task
  app.post('/api/task', (req, res) => {
    const { task, agent } = req.body;
    if (!task) return res.status(400).json({ error: 'Missing task content' });
    
    callbacks.submitTask?.({ task, agent: agent || 'dev' });
    res.json({ success: true, message: 'Task submitted successfully' });
  });

  // API to speak to Gemini
  app.post('/api/gemini', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });
    
    callbacks.sendToGemini?.(text);
    res.json({ success: true, message: 'Message sent to Gemini' });
  });

  // API to get current status
  app.get('/api/status', (req, res) => {
    res.json({ status: callbacks.getStatus?.() || 'Unknown' });
  });

  // Server-Sent Events (SSE) to push logs/messages to the web UI
  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    
    webClients.push(res);
    
    // Send initial connection success message
    res.write(`data: ${JSON.stringify({ text: "✅ Đã kết nối với Iris Core!" })}\n\n`);

    req.on('close', () => {
      webClients = webClients.filter(client => client !== res);
    });
  });

  try {
    app.listen(port, '0.0.0.0', () => {
      callbacks.log?.("info", `Web Dashboard running on http://0.0.0.0:${port}`);
    });
  } catch (err) {
    callbacks.log?.("error", `Failed to start Web Server: ${err.message}`);
  }

  // Return function to broadcast messages to all connected Web UIs
  return function sendWebMessage(text) {
    const data = `data: ${JSON.stringify({ text })}\n\n`;
    webClients.forEach(client => client.write(data));
  };
}
