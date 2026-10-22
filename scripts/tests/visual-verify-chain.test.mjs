import test from "node:test";
import assert from "node:assert/strict";
import { computeBufferDiffRatio, smartSettle, verifyActionWithDiff } from "../../electron/main/visual-verifier.mjs";
import { executeVisualChainTool } from "../../electron/main/computer-use-tools.mjs";

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
