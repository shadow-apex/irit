// Điều khiển cửa sổ CHÍNH Iris bằng giọng nói: "thu nhỏ" (PiP) ≠ "ẩn/dấu trừ" (minimize) ≠ "phóng to/mở lại" (restore).
// minimize_app/hide_app/close_app/restore_app luôn loại cửa sổ Iris (system_actions.py) ⇒ Iris cần action riêng của control_ui.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildClaudeTools } from "../../electron/main/claude-tools-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const decls = buildClaudeTools()[0].functionDeclarations;
const controlUiDecl = decls.find((d) => d.name === "control_ui");
const actionDesc = controlUiDecl.parameters.properties.action.description;
const cuSrc = read("electron/main/computer-use-tools.mjs");

// Chạy controlUi thật với mainWindow giả (computer-use-tools.mjs import electron nên không import trực tiếp được).
function loadControlUi(mainWindow) {
  const start = cuSrc.indexOf("export function controlUi(");
  const end = cuSrc.indexOf("export async function startComputerUseTask");
  assert.ok(start > 0 && end > start);
  const code = cuSrc.slice(start, end).replace("export function controlUi(", "function controlUi(");
  const sent = [];
  const ctx = { mainWindow, UI_ACTIONS: new Set(), emitToRenderer: (...a) => sent.push(a), sent };
  vm.runInNewContext(code + "\nthis.controlUi = controlUi;", ctx);
  return ctx;
}

test("catalog: control_ui liệt kê minimize_iris + restore_iris, mô tả sạch (không lặp, không lỗi mã hóa)", () => {
  assert.match(actionDesc, /\bminimize_iris\b/);
  assert.match(actionDesc, /\brestore_iris\b/);
  assert.equal(actionDesc.includes("?"), false, "mô tả control_ui còn ký tự '?' (lỗi mã hóa)");
  assert.equal((actionDesc.match(/toggle_robot_pip/g) || []).length, 3, "toggle_robot_pip: danh sách + quy tắc 'thu nhỏ' + quy tắc 'phóng to' (nhiều hơn = ghi chú bị lặp)");
  assert.match(actionDesc, /thu nhỏ[\s\S]*Picture-in-Picture[\s\S]*toggle_robot_pip/);
  assert.doesNotMatch(actionDesc, /use minimize_app tool instead/);
});

test("catalog: minimize_app/restore_app chỉ rõ không dùng cho Iris và không còn 'Irit.exe'", () => {
  const byName = Object.fromEntries(decls.map((d) => [d.name, d.description]));
  assert.match(byName.minimize_app, /cannot act on Iris/);
  assert.match(byName.restore_app, /Not for Iris itself/);
  assert.equal(JSON.stringify(decls).includes("Irit.exe"), false);
});

test("controlUi: minimize_iris gọi mainWindow.minimize()", () => {
  let n = 0;
  const { controlUi } = loadControlUi({ isDestroyed: () => false, minimize: () => n++ });
  const r = controlUi({ action: "minimize_iris" });
  assert.equal(r.status, "success");
  assert.equal(n, 1);
  assert.doesNotMatch(r.message, /thu nhỏ/i, "kết quả không được dùng chữ 'thu nhỏ' (dễ nhầm với PiP)");
});

test("controlUi: restore_iris restore (nếu đang thu xuống) + show + focus", () => {
  const calls = [];
  const win = { isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push("restore"), show: () => calls.push("show"), focus: () => calls.push("focus") };
  const { controlUi } = loadControlUi(win);
  assert.equal(controlUi({ action: "restore_iris" }).status, "success");
  assert.deepEqual(calls, ["restore", "show", "focus"]);
  calls.length = 0;
  win.isMinimized = () => false;
  controlUi({ action: "restore_iris" });
  assert.deepEqual(calls, ["show", "focus"]);
});

test("controlUi: không có cửa sổ ⇒ báo lỗi, không ném", () => {
  for (const win of [null, { isDestroyed: () => true }]) {
    const { controlUi } = loadControlUi(win);
    for (const action of ["minimize_iris", "restore_iris"]) assert.equal(controlUi({ action }).status, "error");
  }
});

test("system_actions.py: kết quả minimize không dùng chữ 'thu nhỏ'", () => {
  const src = read("tools/system_actions.py");
  const fn = src.slice(src.indexOf("def minimize_app"), src.indexOf("def hide_app"));
  assert.doesNotMatch(fn, /Đã thu nhỏ/);
  assert.match(fn, /thanh tác vụ/);
});

test("gemini-live: mapping 'thu nhỏ'/'ẩn'/'phóng to' trỏ đúng tool, không còn minimize_app cho Iris", () => {
  const src = read("electron/main/gemini-live.mjs");
  const m = src.slice(src.indexOf("IMPORTANT VIETNAMESE UI MAPPING"), src.indexOf("NEVER confuse these."));
  assert.match(m, /toggle_robot_pip/);
  assert.match(m, /minimize_iris/);
  assert.match(m, /restore_iris/);
  assert.equal(src.includes("Irit.exe"), false);
});
