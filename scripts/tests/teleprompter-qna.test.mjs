import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tpSrc = fs.readFileSync(path.join(root, "electron/main/teleprompter.mjs"), "utf8");

test("teleprompter.mjs: sử dụng ANTHROPIC_API_KEY dùng chung và không khoá cứng claude-sonnet-5", () => {
  assert.ok(tpSrc.includes("process.env.ANTHROPIC_API_KEY"), "Phải kiểm tra process.env.ANTHROPIC_API_KEY");
  assert.ok(!tpSrc.includes('"claude-sonnet-5"'), "Không được dùng model giả 'claude-sonnet-5'");
  assert.ok(tpSrc.includes("claude-3-7-sonnet-latest") || tpSrc.includes("claude-3-5-sonnet-20241022"), "Cần dùng model Claude hợp lệ");
});

test("teleprompter.mjs: askTeleprompter không chặn người dùng khi liveTranscriber dead", () => {
  const start = tpSrc.indexOf("export async function askTeleprompter(question) {");
  const askCode = tpSrc.slice(start);
  assert.ok(!askCode.includes("liveTranscriber"), "askTeleprompter không được phụ thuộc vào liveTranscriber");
});

test("teleprompter.mjs: có fallback sang Gemini Vision và chụp màn hình", () => {
  assert.ok(tpSrc.includes("grabPrimaryScreenJpeg"), "Phải import và gọi grabPrimaryScreenJpeg cho Gemini Vision");
  assert.ok(tpSrc.includes("GEMINI_VISION_API_KEY") && tpSrc.includes("GEMINI_API_KEY"), "Phải hỗ trợ cả GEMINI_VISION_API_KEY và GEMINI_API_KEY dùng chung");
});

test("askTeleprompter logic: kiểm tra câu hỏi rỗng và ưu tiên Claude trước Gemini Vision", async () => {
  const copilotBuffer = ["Đối tác: Hôm nay tình hình thế nào?"];
  const copilotHistory = [];
  let copilotStatus = "";
  let copilotEnabled = false;
  let hudUpdated = false;

  const mockContext = {
    copilotBuffer,
    copilotHistory,
    COPILOT_HISTORY_MAX: 100,
    liveTranscripts: [],
    get copilotStatus() { return copilotStatus; },
    set copilotStatus(v) { copilotStatus = v; },
    get copilotEnabled() { return copilotEnabled; },
    set copilotEnabled(v) { copilotEnabled = v; },
    enterHud: () => {},
    updateTeleprompterHud: () => { hudUpdated = true; },
    process: {
      env: {
        ANTHROPIC_API_KEY: "mock-anthropic-key",
        GEMINI_API_KEY: "mock-gemini-key",
      },
    },
    console: {
      warn: () => {},
      log: () => {},
      error: () => {},
    },
    Buffer,
    setTimeout,
    clearTimeout,
  };

  const start = tpSrc.indexOf("export async function askTeleprompter(question) {");
  assert.ok(start > 0, "Tìm thấy hàm askTeleprompter");
  const fnCode = tpSrc.slice(start).replace("export async function askTeleprompter", "async function askTeleprompter");

  // Trường hợp 1: Claude thành công -> engine là Claude
  const sandbox1 = {
    ...mockContext,
    callClaudeForTeleprompter: async () => "Câu trả lời từ Claude",
    getGeminiVisionClient: async () => assert.fail("Không được gọi Gemini nếu Claude đã thành công"),
    grabPrimaryScreenJpeg: async () => ({ buffer: Buffer.from("fake-jpeg") }),
  };
  vm.runInNewContext(`${fnCode}\nthis.askTeleprompter = askTeleprompter;`, sandbox1);

  // Câu hỏi rỗng bị từ chối
  const emptyRes = await sandbox1.askTeleprompter("   ");
  assert.equal(emptyRes.status, "error");
  assert.match(emptyRes.error, /không được để trống/i);

  // Câu hỏi hợp lệ -> Claude được dùng
  const res1 = await sandbox1.askTeleprompter("Báo cáo tháng");
  assert.equal(res1.status, "success");
  assert.equal(res1.engine, "Claude");
  assert.equal(sandbox1.copilotHistory.length, 1);
  assert.equal(sandbox1.copilotHistory[0].engine, "Claude");
  assert.equal(sandbox1.copilotHistory[0].answer, "Câu trả lời từ Claude");

  // Trường hợp 2: Claude thất bại & người dùng yêu cầu Vision -> Tự động fallback sang Gemini Vision và chụp màn hình
  let geminiVisionCalled = false;
  let screenCaptured = false;
  const sandbox2 = {
    ...mockContext,
    copilotHistory: [],
    callClaudeForTeleprompter: async () => { throw new Error("Claude credit expired / 429 rate limit"); },
    grabPrimaryScreenJpeg: async () => {
      screenCaptured = true;
      return { buffer: Buffer.from("fake-screen-jpeg") };
    },
    getGeminiVisionClient: async () => ({
      models: {
        generateContent: async ({ contents }) => {
          geminiVisionCalled = true;
          // Xác thực ảnh màn hình đã được đính kèm vào nội dung gửi Gemini
          const hasImage = contents.some((c) => c.inlineData && c.inlineData.mimeType === "image/jpeg");
          assert.ok(hasImage, "Gemini Vision phải nhận được ảnh chụp màn hình inlineData");
          return { text: "Câu trả lời từ Gemini Vision" };
        },
      },
    }),
  };
  vm.runInNewContext(`${fnCode}\nthis.askTeleprompter = askTeleprompter;`, sandbox2);

  const res2 = await sandbox2.askTeleprompter("Màn hình này đang mở gì?", { isFullScreen: true });
  assert.equal(res2.status, "success");
  assert.equal(res2.engine, "Gemini Vision");
  assert.ok(screenCaptured, "Chụp màn hình phải được kích hoạt");
  assert.ok(geminiVisionCalled, "Gemini Vision phải được gọi");
  assert.equal(sandbox2.copilotHistory.length, 1);
  assert.equal(sandbox2.copilotHistory[0].engine, "Gemini Vision");
  assert.equal(sandbox2.copilotHistory[0].answer, "Câu trả lời từ Gemini Vision");

  // Trường hợp 3: Hỏi văn bản thuần bằng cách ấn Enter (không chọn chụp màn hình) -> Tuyệt đối KHÔNG chụp màn hình
  let textScreenCaptured = false;
  let textOnlyCalled = false;
  const sandbox3 = {
    ...mockContext,
    copilotHistory: [],
    callClaudeForTeleprompter: async () => { throw new Error("Claude credit expired"); },
    grabPrimaryScreenJpeg: async () => {
      textScreenCaptured = true;
      return { buffer: Buffer.from("fake-screen-jpeg") };
    },
    getGeminiVisionClient: async () => ({
      models: {
        generateContent: async ({ contents }) => {
          textOnlyCalled = true;
          const hasImage = contents.some((c) => c.inlineData);
          assert.equal(hasImage, false, "Ấn Enter hỏi thông thường không được gửi kèm ảnh");
          return { text: "Câu trả lời dạng văn bản từ Gemini" };
        },
      },
    }),
  };
  vm.runInNewContext(`${fnCode}\nthis.askTeleprompter = askTeleprompter;`, sandbox3);

  const res3 = await sandbox3.askTeleprompter("Giải thích quy tắc SOLID");
  assert.equal(res3.status, "success");
  assert.equal(res3.engine, "Gemini");
  assert.equal(textScreenCaptured, false, "Ấn Enter hỏi thông thường tuyệt đối không được gọi grabPrimaryScreenJpeg");
  assert.equal(textOnlyCalled, true, "Gemini text-only phải được gọi");
  assert.equal(sandbox3.copilotHistory.length, 1);
  assert.equal(sandbox3.copilotHistory[0].engine, "Gemini");
  assert.equal(sandbox3.copilotHistory[0].answer, "Câu trả lời dạng văn bản từ Gemini");
});
