// Mọi tool khai báo cho Gemini Live phải (1) có case trong dispatcher, (2) có schema hợp lệ,
// (3) mọi tham số khai báo trong catalog phải thật sự được dispatcher/wrapper chuyển tiếp.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeTools } from "../../electron/main/claude-tools-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dispatcher = fs.readFileSync(path.join(root, "electron/main/tool-dispatcher.mjs"), "utf8");
const decls = buildClaudeTools()[0].functionDeclarations;
const cases = new Set([...dispatcher.matchAll(/case "([a-zA-Z0-9_]+)"/g)].map((m) => m[1]));

test("khai báo ↔ case khớp hai chiều, tên không trùng", () => {
  const names = decls.map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.filter((n) => !cases.has(n)), []);
  assert.deepEqual([...cases].filter((c) => !names.includes(c)), []);
});

test("schema hợp lệ cho Gemini: parameters là object, type hợp lệ, required tồn tại, không có input_schema", () => {
  const OK = new Set(["string", "integer", "number", "boolean", "object", "array"]);
  for (const d of decls) {
    assert.equal(d.parameters?.type, "object", d.name);
    assert.ok(!("input_schema" in d), d.name);
    for (const r of d.parameters.required || []) assert.ok(d.parameters.properties?.[r], `${d.name}.required → ${r}`);
    for (const [k, p] of Object.entries(d.parameters.properties || {})) assert.ok(OK.has(p.type), `${d.name}.${k} type=${p.type}`);
  }
});

test("tool có tham số: thân `case` phải thực sự dùng `args` (không gọi hàm trần bỏ rơi tham số)", () => {
  const body = (name) => {
    const start = dispatcher.indexOf(`case "${name}":`);
    assert.ok(start >= 0, name);
    const rest = dispatcher.slice(start + 1);
    const next = rest.search(/\n\s{4}case "|\n\s{4}default:/);
    return rest.slice(0, next < 0 ? undefined : next);
  };
  const needArgs = decls
    .filter((d) => Object.keys(d.parameters.properties || {}).filter((k) => k !== "confirm_token").length > 0)
    .map((d) => d.name);
  for (const name of needArgs) {
    assert.match(body(name), /\bargs\b/, `${name}: catalog khai báo tham số nhưng case không dùng args`);
  }
});

test("hàm hiện thực nhận đúng một đối tượng `args` (hồi quy: take_ai_screenshot bỏ rơi save)", () => {
  assert.match(body2("take_ai_screenshot"), /takeAiScreenshotTool\(args\)/);
  function body2(n) { return dispatcher.slice(dispatcher.indexOf(`case "${n}":`), dispatcher.indexOf(`case "${n}":`) + 120); }
});
