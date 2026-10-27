import test from "node:test";
import assert from "node:assert/strict";
import { computeBufferDiffRatio, smartSettle, verifyActionWithDiff } from "../../../electron/main/visual-verifier.mjs";
import {
  executeVisualChainTool,
  getToolMemoryState,
  resetToolMemoryState,
  recordToolExecution,
  resolveMemoryPath,
  interpolatePipelineArgs,
} from "../../../electron/main/computer-use-tools.mjs";
import {
  extractActionItemsFromSummary,
  estimateReminderMinutesFromDeadline,
  buildPrintableMinutesHtml,
} from "../../../electron/main/meeting-recording.mjs";
import { isFrameMeaningfullyDifferent } from "../../../electron/main/vision.mjs";
import { isQuestionLikeUtterance } from "../../../electron/main/teleprompter.mjs";

test("computeBufferDiffRatio: tính toán tỷ lệ khác biệt ảnh chính xác", () => {
  // 1. Buffer giống hệt nhau -> diff = 0
  const bufA = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const bufB = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  assert.equal(computeBufferDiffRatio(bufA, bufB), 0.0, "Ảnh giống hệt phải có diff = 0");

  // 2. Buffer khác biệt -> diff > 0
  const bufC = Buffer.from("SOMETHING_COMPLETELY_DIFFERENT_1234567890_XYZ", "utf8");
  const diff = computeBufferDiffRatio(bufA, bufC);
  assert.ok(diff > 0.1, `Ảnh khác biệt phải có diff > 0.1 (thực tế: ${diff})`);

  // 3. Fallback an toàn với null / rỗng
  assert.equal(computeBufferDiffRatio(null, null), 1.0);
  assert.equal(computeBufferDiffRatio(Buffer.alloc(0), Buffer.alloc(0)), 0.0);
});

test("smartSettle: chờ render không ném lỗi và hoàn thành nhanh", async () => {
  const start = Date.now();
  await smartSettle({ minWaitMs: 50, maxWaitMs: 100 });
  const duration = Date.now() - start;
  assert.ok(duration >= 40, `smartSettle phải chờ ít nhất minWaitMs (thực tế: ${duration}ms)`);
});

test("verifyActionWithDiff: tự động thử lại (Self-Healing) khi diff nhỏ", async () => {
  let retryCount = 0;
  const mockBefore = {
    buffer: Buffer.from([1, 2, 3, 4, 5]),
  };

  // Giả lập retryFn thực hiện hành động sửa sai
  const retryFn = async () => {
    retryCount++;
  };

  // Thử nghiệm chạy nghiệm thu
  const res = await verifyActionWithDiff({
    beforeSnapshot: mockBefore,
    cropRectOrPoint: { x: 100, y: 100, width: 50, height: 50 },
    label: "test button",
    minDiffRatio: 0.01,
    maxRetries: 1,
    retryFn,
  });

  assert.ok(res, "Kết quả trả về phải tồn tại");
  assert.equal(typeof res.verified, "boolean", "verified phải là boolean");
});

test("executeVisualChainTool: từ chối khi thiếu danh sách bước", async () => {
  const res = await executeVisualChainTool({});
  assert.equal(res.status, "error");
  assert.match(res.error, /Thiếu danh sách bước/);
});

test("executeVisualChainTool: thực thi chuỗi tuần hoàn hợp lệ", async () => {
  const steps = [
    { action: "wait", duration_ms: 50 },
    { action: "wait", duration_ms: 50 },
  ];

  const res = await executeVisualChainTool({
    goal: "Kiểm tra chuỗi đa bước",
    steps,
  });

  assert.equal(res.status, "success");
  assert.equal(res.total_steps, 2);
  assert.equal(res.executed_steps.length, 2);
  assert.ok(res.message.includes("thành công"));
});

test("Fast-Path Memory Pipeline: nội suy biến {{prev.*}} và {{stepN.*}} cùng theo dõi thói quen", () => {
  resetToolMemoryState();
  recordToolExecution(
    "search_local_files",
    { query: "bao_cao_q3.xlsx" },
    {
      results: [
        { path: "C:\\Reports\\bao_cao_q3.xlsx", name: "bao_cao_q3.xlsx" },
      ],
    },
    "step1",
  );

  assert.equal(resolveMemoryPath("prev.first_path"), "C:\\Reports\\bao_cao_q3.xlsx");
  assert.equal(resolveMemoryPath("step1.results.0.name"), "bao_cao_q3.xlsx");

  const interpolated = interpolatePipelineArgs({
    action: "read_file",
    path: "{{prev.first_path}}",
    note: "Đọc file {{step1.results.0.name}} bằng $prev.first_path",
  });

  assert.equal(interpolated.path, "C:\\Reports\\bao_cao_q3.xlsx");
  assert.equal(
    interpolated.note,
    "Đọc file bao_cao_q3.xlsx bằng C:\\Reports\\bao_cao_q3.xlsx",
  );

  recordToolExecution("open_application", { app_name: "excel" }, { status: "ok" });
  const mem = getToolMemoryState();
  assert.equal(mem.userHabits.frequentApps.excel, 1);
  assert.ok(mem.userHabits.recentFiles.includes("C:\\Reports\\bao_cao_q3.xlsx"));
});

test("Alt+M Smart Meeting Minutes: trích xuất Action Items, ước lượng deadline và tạo HTML biên bản", () => {
  const sampleMd = `
## 1. Tóm Tắt Điều Hành (Executive Summary)
Cuộc họp chốt kế hoạch phát hành Iris v2.0.

## 4. Danh Sách Công Việc Cần Làm (Action Items & To-Do List)
| STT | Công việc cụ thể (Action Item) | Người phụ trách (Owner) | Thời hạn (Deadline) | Mức độ ưu tiên |
|---|---|---|---|---|
| 1 | Hoàn thiện module Vision Diff | Bạn | 45 phút | Cao |
| 2 | Gửi tài liệu API cho khách hàng | Minh | ngày mai | Trung bình |
`;

  const items = extractActionItemsFromSummary(sampleMd);
  assert.equal(items.length, 2);
  assert.equal(items[0].task, "Hoàn thiện module Vision Diff");
  assert.equal(items[0].owner, "Bạn");
  assert.equal(items[0].priority, "Cao");
  assert.equal(estimateReminderMinutesFromDeadline(items[0].deadline), 45);
  assert.equal(estimateReminderMinutesFromDeadline(items[1].deadline), 720);

  const html = buildPrintableMinutesHtml(sampleMd, "2026-10-27_10-00-00");
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("Hoàn thiện module Vision Diff"));
});

test("Alt+T & Vision: nhận diện câu hỏi song ngữ Anh-Việt và lọc nhiễu Smart Screen Diff", () => {
  assert.equal(isQuestionLikeUtterance("Can you explain how the architecture works"), true);
  assert.equal(isQuestionLikeUtterance("Tại sao hệ thống dùng UIA COM thế em"), true);
  assert.equal(isQuestionLikeUtterance("Cảm ơn bạn đã lắng nghe"), false);

  const frameA = Buffer.alloc(1024, 65).toString("base64");
  const frameAIdentical = Buffer.alloc(1024, 65).toString("base64");
  const frameBChanged = Buffer.alloc(1024, 120).toString("base64");

  assert.equal(isFrameMeaningfullyDifferent(frameA, frameAIdentical, 0.008), false);
  assert.equal(isFrameMeaningfullyDifferent(frameA, frameBChanged, 0.008), true);
});
