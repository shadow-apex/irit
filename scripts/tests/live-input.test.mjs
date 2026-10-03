// V-01 — frame phải tới Gemini dưới dạng {video:{...}}, dùng Session THẬT của SDK.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Session } from "@google/genai";
import { buildVideoInput, detectImageMime, stripDataUrl } from "../../electron/main/live-input.mjs";

const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]).toString("base64");
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString("base64");
const WEBP_B64 = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20)]).toString("base64");

function realSession() {
  const sent = [];
  const ai = new GoogleGenAI({ apiKey: "unit-test" });
  const session = new Session({ send: (m) => sent.push(JSON.parse(m)), close() {} }, ai.live.apiClient);
  return { session, sent };
}

test("detectImageMime nhận JPEG/PNG/WebP, từ chối rác", () => {
  assert.equal(detectImageMime(JPEG_B64), "image/jpeg");
  assert.equal(detectImageMime(PNG_B64), "image/png");
  assert.equal(detectImageMime(WEBP_B64), "image/webp");
  assert.equal(detectImageMime(Buffer.from("hello world, not an image").toString("base64")), null);
  assert.equal(detectImageMime(""), null);
  assert.equal(detectImageMime(null), null);
});

test("buildVideoInput trả object {video}, KHÔNG phải mảng", () => {
  const input = buildVideoInput(JPEG_B64);
  assert.equal(Array.isArray(input), false);
  assert.deepEqual(input, { video: { data: JPEG_B64, mimeType: "image/jpeg" } });
  assert.equal(buildVideoInput("", "image/jpeg"), null);
  assert.equal(buildVideoInput("bm90IGFuIGltYWdlIGF0IGFsbA==") , null);
  assert.equal(buildVideoInput(PNG_B64, "image/png").video.mimeType, "image/png");
});

test("stripDataUrl", () => {
  assert.equal(stripDataUrl(`data:image/jpeg;base64,${JPEG_B64}`), JPEG_B64);
  assert.equal(stripDataUrl(JPEG_B64), JPEG_B64);
  assert.equal(stripDataUrl(undefined), "");
});

test("Session THẬT: payload mới tạo realtimeInput.video; payload mảng cũ tạo realtimeInput RỖNG", () => {
  const { session, sent } = realSession();
  session.sendRealtimeInput(buildVideoInput(JPEG_B64));
  assert.equal(sent[0].realtimeInput.video.mimeType, "image/jpeg");
  assert.equal(sent[0].realtimeInput.video.data, JPEG_B64);

  // Chứng minh lỗi gốc: kiểu cũ không mang gì cả.
  session.sendRealtimeInput([{ mimeType: "image/jpeg", data: JPEG_B64 }]);
  assert.deepEqual(sent[1], { realtimeInput: {} });
});

test("gác cổng: không còn sendRealtimeInput([ trong electron/", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "electron");
  const offenders = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|cjs|js)$/.test(e.name) && /sendRealtimeInput\(\s*\[/.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
    }
  })(root);
  assert.deepEqual(offenders, []);
});
