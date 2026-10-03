// Chép WASM của @mediapipe/tasks-vision vào public/mediapipe/wasm và (nếu có mạng) tải
// gesture_recognizer.task một lần, để hand-tracking chạy OFFLINE. Không bao giờ làm hỏng
// `npm run dev/build`: thiếu mạng thì chỉ cảnh báo, ứng dụng tự rơi về CDN.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "mediapipe");
const srcWasm = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";

try {
  if (fs.existsSync(srcWasm)) {
    const dst = path.join(outDir, "wasm");
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(srcWasm)) {
      const to = path.join(dst, f);
      if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(path.join(srcWasm, f)).size) {
        fs.copyFileSync(path.join(srcWasm, f), to);
      }
    }
    console.log("[mediapipe] WASM đã sẵn sàng tại public/mediapipe/wasm");
  } else {
    console.warn("[mediapipe] chưa có node_modules/@mediapipe/tasks-vision — bỏ qua chép WASM.");
  }

  const model = path.join(outDir, "gesture_recognizer.task");
  if (!fs.existsSync(model)) {
    try {
      const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(model, Buffer.from(await res.arrayBuffer()));
      console.log("[mediapipe] đã tải gesture_recognizer.task");
    } catch (e) {
      console.warn(`[mediapipe] không tải được model (${e.message}) — hand-tracking sẽ dùng CDN. Chạy lại \`npm run setup:mediapipe\` khi có mạng.`);
    }
  }
} catch (e) {
  console.warn("[mediapipe] bỏ qua:", e.message);
}
