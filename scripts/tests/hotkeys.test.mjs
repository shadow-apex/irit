import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HOTKEYS, resolveHotkeys } from "../../electron/main/hotkeys.mjs";

test("không đặt IRIS_HOTKEYS -> giữ nguyên phím mặc định, không cảnh báo", () => {
  for (const raw of [undefined, "", "   "]) {
    const { hotkeys, warnings } = resolveHotkeys(raw);
    assert.deepEqual(hotkeys, { ...DEFAULT_HOTKEYS });
    assert.deepEqual(warnings, []);
  }
});

test("ghi đè một phím, các phím còn lại giữ mặc định", () => {
  const { hotkeys, warnings } = resolveHotkeys('{"robotPip":"CommandOrControl+Alt+R"}');
  assert.equal(hotkeys.robotPip, "CommandOrControl+Alt+R");
  assert.equal(hotkeys.teleprompter, DEFAULT_HOTKEYS.teleprompter);
  assert.deepEqual(warnings, []);
});

test("giá trị rỗng / null / false tắt phím", () => {
  const { hotkeys } = resolveHotkeys('{"teleprompter":"","copilot":null,"meetingRecorder":false}');
  assert.equal(hotkeys.teleprompter, null);
  assert.equal(hotkeys.copilot, null);
  assert.equal(hotkeys.meetingRecorder, null);
  assert.equal(hotkeys.robotPip, DEFAULT_HOTKEYS.robotPip);
});

test("JSON hỏng hoặc không phải object -> dùng mặc định và cảnh báo", () => {
  for (const raw of ["{not json", "[1,2]", '"Alt+R"', "42"]) {
    const { hotkeys, warnings } = resolveHotkeys(raw);
    assert.deepEqual(hotkeys, { ...DEFAULT_HOTKEYS }, raw);
    assert.equal(warnings.length, 1, raw);
  }
});

test("khoá không biết bị bỏ qua kèm cảnh báo", () => {
  const { hotkeys, warnings } = resolveHotkeys('{"nope":"Alt+Z"}');
  assert.equal("nope" in hotkeys, false);
  assert.match(warnings[0], /nope/);
});

test("accelerator không hợp lệ -> dùng mặc định và cảnh báo (kể cả chuỗi chứa ký tự lạ)", () => {
  for (const bad of ["Alt+R; calc", 'Alt+"R"', 123, {}, "A".repeat(41)]) {
    const { hotkeys, warnings } = resolveHotkeys(JSON.stringify({ robotPip: bad }));
    assert.equal(hotkeys.robotPip, DEFAULT_HOTKEYS.robotPip, String(bad));
    assert.equal(warnings.length, 1, String(bad));
  }
});

test("trùng phím: phím đứng trước trong DEFAULT_HOTKEYS thắng, phím sau bị tắt (không phân biệt hoa/thường)", () => {
  const { hotkeys, warnings } = resolveHotkeys('{"companionPip":"alt+r"}');
  assert.equal(hotkeys.robotPip, "Alt+R");
  assert.equal(hotkeys.companionPip, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /companionPip/);
});

test("hoán đổi hai phím hợp lệ không bị coi là trùng", () => {
  const { hotkeys, warnings } = resolveHotkeys('{"robotPip":"Alt+C","companionPip":"Alt+R"}');
  assert.equal(hotkeys.robotPip, "Alt+C");
  assert.equal(hotkeys.companionPip, "Alt+R");
  assert.deepEqual(warnings, []);
});
