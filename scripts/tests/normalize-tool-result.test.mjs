import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeToolResult, parseToolOutput, buildToolResponse, optArg, toIntArg } from "../../electron/main/tool-result.mjs";
import { frameToScreen } from "../../electron/main/coords.mjs";

test("{success:false} + exit 0 => error (TL-03)", () => {
  const r = normalizeToolResult({ success: false, error: "x" }, { exitCode: 0 });
  assert.equal(r.status, "error"); assert.equal(r.error, "x"); assert.equal("success" in r, false);
});
test("{error} không có success => error", () => {
  assert.equal(normalizeToolResult({ error: "boom" }).status, "error");
});
test("{status:'success'} => success; {success:true} => success", () => {
  assert.equal(normalizeToolResult({ status: "success", message: "m" }).status, "success");
  assert.equal(normalizeToolResult({ success: true, a: 1 }).status, "success");
});
test("exit != 0 => error dù JSON nói success; luôn có error", () => {
  const r = normalizeToolResult({ success: true }, { exitCode: 2, fallbackError: "fb" });
  assert.equal(r.status, "error"); assert.equal(r.error, "fb");
});
test("trường của script không đè được status (status đặt sau cùng)", () => {
  assert.equal(normalizeToolResult({ success: false, status: "success" }).status, "error");
  assert.equal(normalizeToolResult({ success: true, status: "error" }).status, "error");
});
test("parseToolOutput lấy dòng JSON cuối, bỏ qua rác phía trước", () => {
  assert.deepEqual(parseToolOutput('warn: x\n{"success":true,"a":1}\n'), { success: true, a: 1 });
  assert.equal(parseToolOutput("not json"), null);
  assert.equal(parseToolOutput(""), null);
  assert.deepEqual(parseToolOutput('{\n  "a": 1\n}'), { a: 1 });
});
test("buildToolResponse: không JSON => KHÔNG BAO GIỜ success", () => {
  assert.equal(buildToolResponse({ ok: true, stdout: "xong rồi" }).status, "error");
  assert.equal(buildToolResponse({ ok: true, stdout: "" }).status, "error");
  assert.equal(buildToolResponse({ ok: false, code: 1, stdout: "", stderr: "Traceback..." }).error, "Traceback...");
  assert.equal(buildToolResponse({ ok: false, timedOut: true, error: "Quá thời gian" }).status, "error");
});
test("buildToolResponse: script lỗi (exit 1) kèm JSON lỗi", () => {
  const r = buildToolResponse({ ok: false, code: 1, stdout: '{"success":false,"error":"không tìm thấy"}' });
  assert.equal(r.status, "error"); assert.equal(r.error, "không tìm thấy");
});
test("optArg / toIntArg (TL-14)", () => {
  assert.equal(optArg("text", "-5"), "--text=-5");
  assert.equal(optArg("title", "a b"), "--title=a b");
  assert.equal(toIntArg(123.5), 124); assert.equal(toIntArg("7.4"), 7); assert.equal(toIntArg(-3), -3);
  assert.equal(toIntArg(undefined), null); assert.equal(toIntArg(NaN), null); assert.equal(toIntArg("abc"), null); assert.equal(toIntArg(""), null);
});
test("frameToScreen: khung 1280x720 => màn 2560x1440 (TL-05)", () => {
  const g = { frame_w: 1280, frame_h: 720, screen_w: 2560, screen_h: 1440, origin_x: 0, origin_y: 0 };
  assert.deepEqual(frameToScreen(640, 360, g), { x: 1280, y: 720 });
  assert.deepEqual(frameToScreen(0, 0, g), { x: 0, y: 0 });
  assert.deepEqual(frameToScreen(5000, -5, g), { x: 2560, y: 0 });   // kẹp trong khung
  assert.deepEqual(frameToScreen(10, 10, { ...g, origin_x: -2560 }), { x: -2540, y: 20 });
  assert.throws(() => frameToScreen(1, 1, null));
});
