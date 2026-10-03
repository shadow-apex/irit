// Chép WASM của onnxruntime-web vào public/ort/ để wake word ("Hey Iris") chạy OFFLINE
// thay vì nạp từ CDN jsDelivr. Không bao giờ làm hỏng `npm install/dev/build`: thiếu
// node_modules thì chỉ cảnh báo, ứng dụng tự rơi về CDN (xem src/hooks/useWakeWord.ts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "node_modules", "onnxruntime-web", "dist");
const outDir = path.join(root, "public", "ort");

try {
  if (!fs.existsSync(srcDir)) {
    console.warn("[ort] chưa có node_modules/onnxruntime-web — bỏ qua (wake word sẽ dùng CDN).");
  } else {
    const files = fs.readdirSync(srcDir).filter((f) => /^ort-wasm.*\.(wasm|mjs|js)$/i.test(f));
    if (files.length === 0) {
      console.warn("[ort] không thấy file ort-wasm* trong dist — bỏ qua (wake word sẽ dùng CDN).");
    } else {
      fs.mkdirSync(outDir, { recursive: true });
      for (const f of files) {
        const from = path.join(srcDir, f);
        const to = path.join(outDir, f);
        if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) fs.copyFileSync(from, to);
      }
      // Dấu hiệu "đã sẵn sàng": useWakeWord chỉ dùng bản local khi file này tồn tại,
      // tránh trường hợp thư mục có nhưng chép dở.
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "onnxruntime-web", "package.json"), "utf8"));
      fs.writeFileSync(path.join(outDir, "ready.txt"), `onnxruntime-web ${pkg.version}\n`);
      console.log(`[ort] đã chép ${files.length} file vào public/ort (onnxruntime-web ${pkg.version})`);
    }
  }
} catch (e) {
  console.warn("[ort] bỏ qua:", e.message);
}
