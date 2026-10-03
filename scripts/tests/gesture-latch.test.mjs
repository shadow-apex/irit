// V-09 — cử chỉ chỉ bắn theo cạnh; giữ nguyên tư thế KHÔNG bắn lại.
import test from "node:test";
import assert from "node:assert/strict";
import { createGestureLatch } from "../../src/lib/gestureLatch.ts";

test("giữ Thumb_Up 10 giây => chỉ bắn đúng 1 lần (trước đây lặp mỗi giây)", () => {
  const l = createGestureLatch();
  let fires = 0;
  for (let t = 0; t <= 10_000; t += 33) fires += l.update(["thumb_up"], t).length;
  assert.equal(fires, 1);
});

test("nhả rồi làm lại: cần nhả >= 300ms và qua cooldown 1.2s", () => {
  const l = createGestureLatch();
  assert.deepEqual(l.update(["victory"], 0), ["victory"]);
  l.update([], 100);
  assert.deepEqual(l.update(["victory"], 150), [], "nhả mới 50ms và còn trong cooldown");
  l.update([], 200);
  l.update([], 700);
  assert.deepEqual(l.update(["victory"], 800), [], "đã nhả đủ nhưng còn trong cooldown 1.2s");
  l.update([], 900);
  l.update([], 1400);
  assert.deepEqual(l.update(["victory"], 1500), ["victory"]);
});

test("nhấp nháy ngắn (<300ms) không tạo lần bắn mới", () => {
  const l = createGestureLatch({ cooldownMs: 0 });
  assert.equal(l.update(["pinch"], 0).length, 1);
  l.update([], 50);
  assert.equal(l.update(["pinch"], 100).length, 0, "nhả chỉ 50ms");
  l.update([], 200); l.update([], 600);
  assert.equal(l.update(["pinch"], 700).length, 1);
});

test("thumb_down phải giữ liên tục >= 2000ms; đổi cử chỉ giữa chừng thì huỷ", () => {
  const l = createGestureLatch({ holdMs: { thumb_down: 2000 } });
  let fired = [];
  for (let t = 0; t < 1900; t += 100) fired.push(...l.update(["thumb_down"], t));
  assert.deepEqual(fired, []);
  l.update([], 1950); // đổi sang cử chỉ khác
  l.update([], 2400); // đã nhả > 300ms
  for (let t = 2500; t < 4400; t += 100) fired.push(...l.update(["thumb_down"], t));
  assert.deepEqual(fired, [], "đồng hồ giữ phải bắt đầu lại sau khi đổi (mới giữ 1.9s)");
  fired.push(...l.update(["thumb_down"], 4500));
  assert.deepEqual(fired, ["thumb_down"], "đủ 2s liên tục => bắn");
});

test("shush cần giữ >= 800ms", () => {
  const l = createGestureLatch({ holdMs: { shush: 800 } });
  assert.deepEqual(l.update(["shush"], 0), []);
  assert.deepEqual(l.update(["shush"], 700), []);
  assert.deepEqual(l.update(["shush"], 800), ["shush"]);
  assert.deepEqual(l.update(["shush"], 3000), []);
});

test("pulse (swipe/zoom): bắn một lần rồi cooldown", () => {
  const l = createGestureLatch();
  assert.equal(l.pulse("swipe_left", 0), true);
  assert.equal(l.pulse("swipe_left", 500), false);
  assert.equal(l.pulse("swipe_right", 500), true, "cử chỉ khác có cooldown riêng");
  assert.equal(l.pulse("swipe_left", 1300), true);
});
