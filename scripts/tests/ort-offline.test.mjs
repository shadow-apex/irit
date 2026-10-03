import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("URL CDN fallback của ONNX Runtime khớp phiên bản trong package-lock.json", () => {
  const lock = JSON.parse(read("package-lock.json"));
  const installed = lock.packages["node_modules/onnxruntime-web"].version;
  const src = read("src/hooks/useWakeWord.ts");
  assert.ok(
    src.includes(`onnxruntime-web@${installed}/dist/`),
    `CDN_ORT_URL phải trỏ onnxruntime-web@${installed} (bản đang cài), nếu không WASM lệch JS sẽ lỗi khi chạy`,
  );
});

test("useWakeWord ưu tiên bản tự host public/ort và script chép tồn tại", () => {
  const src = read("src/hooks/useWakeWord.ts");
  assert.ok(src.includes("ort/ready.txt"), "phải dò public/ort/ready.txt trước khi dùng CDN");
  assert.ok(fs.existsSync(path.join(root, "scripts", "prepare-ort.mjs")));
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["setup:ort"], "node scripts/prepare-ort.mjs");
});
