// S-11 — thao tác nguy hiểm không thực thi nếu chưa xác nhận lần hai.
import test from "node:test";
import assert from "node:assert/strict";
import { createConfirmGate, isDangerousCall, annotateDangerousDeclarations, CONFIRM_TTL_MS } from "../../electron/main/dangerous-tools.mjs";
import { buildClaudeTools } from "../../electron/main/claude-tools-catalog.mjs";

test("nhận diện lời gọi nguy hiểm / an toàn", () => {
  assert.equal(isDangerousCall("power_manager", { action: "shutdown" }), true);
  assert.equal(isDangerousCall("power_manager", { action: "restart" }), true);
  assert.equal(isDangerousCall("power_manager", { action: "sleep" }), true);
  assert.equal(isDangerousCall("process_manager", { action: "kill", name: "chrome.exe" }), true);
  assert.equal(isDangerousCall("process_manager", { action: "list" }), false);
  assert.equal(isDangerousCall("system_control", { wifi: "off" }), true);
  assert.equal(isDangerousCall("system_control", { camera: "off" }), true);
  assert.equal(isDangerousCall("system_control", { volume: "up" }), false);
  assert.equal(isDangerousCall("system_control", { wifi: "on" }), false);
  assert.equal(isDangerousCall("close_app", { target: "x.exe" }), true);
  assert.equal(isDangerousCall("media_control", { action: "next" }), false);
});

test("lần đầu: needs_confirmation (không thực thi); lần hai đúng token: cho phép, dùng một lần", () => {
  const g = createConfirmGate();
  const first = g.check("power_manager", { action: "shutdown" });
  assert.equal(first.status, "needs_confirmation");
  assert.ok(first.confirm_token && first.message.includes(first.confirm_token));
  assert.equal(g.check("power_manager", { action: "shutdown", confirm_token: first.confirm_token }), null);
  const again = g.check("power_manager", { action: "shutdown", confirm_token: first.confirm_token });
  assert.equal(again.status, "error", "token dùng một lần");
});

test("token gắn với đúng tool + đối số: đổi action/tool => từ chối", () => {
  const g = createConfirmGate();
  const t = g.check("power_manager", { action: "sleep" }).confirm_token;
  assert.equal(g.check("power_manager", { action: "shutdown", confirm_token: t }).status, "error");
  const t2 = g.check("process_manager", { action: "kill", name: "a.exe" }).confirm_token;
  assert.equal(g.check("process_manager", { action: "kill", name: "b.exe", confirm_token: t2 }).status, "error");
  assert.equal(g.check("power_manager", { action: "shutdown", confirm_token: "tự-bịa" }).status, "error");
});

test("token hết hạn sau 30 giây", () => {
  let t = 1_000;
  const g = createConfirmGate({ now: () => t });
  const tok = g.check("power_manager", { action: "restart" }).confirm_token;
  t += CONFIRM_TTL_MS + 1;
  assert.equal(g.check("power_manager", { action: "restart", confirm_token: tok }).status, "error");
  assert.equal(g.pendingCount(), 0);
});

test("lời gọi an toàn đi thẳng (null), không tạo token", () => {
  const g = createConfirmGate();
  assert.equal(g.check("process_manager", { action: "list" }), null);
  assert.equal(g.check("media_control", { action: "next" }), null);
  assert.equal(g.pendingCount(), 0);
});

test("onPending được gọi để hiện cảnh báo lên HUD", () => {
  const seen = [];
  const g = createConfirmGate({ onPending: (p) => seen.push(p.what) });
  g.check("power_manager", { action: "shutdown" });
  assert.match(seen[0], /power_manager.*shutdown/);
});

test("catalog: tool nguy hiểm có confirm_token và mô tả quy trình xác nhận", () => {
  const decls = buildClaudeTools().flatMap((g) => g.functionDeclarations || []);
  for (const name of ["power_manager", "system_control", "process_manager", "close_app"]) {
    const d = decls.find((x) => x.name === name);
    assert.ok(d, `thiếu tool ${name}`);
    assert.match(d.description, /needs_confirmation/);
    const schema = d.parameters || d.input_schema;
    assert.ok(schema.properties.confirm_token, `${name} thiếu confirm_token`);
  }
  const safe = decls.find((x) => x.name === "media_control");
  assert.ok(!(safe.parameters || safe.input_schema).properties.confirm_token);
});

test("annotate không nhân đôi chú thích khi gọi lại", () => {
  const d = [{ name: "power_manager", description: "x", parameters: { type: "object", properties: {} } }];
  annotateDangerousDeclarations(d); annotateDangerousDeclarations(d);
  assert.equal(d[0].description.split("needs_confirmation").length - 1, 1);
});

test("catalog: không còn khai báo trùng tên và mọi tool nằm trong functionDeclarations với `parameters`", () => {
  const groups = buildClaudeTools();
  assert.equal(groups.filter((g) => g.functionDeclarations).length, 1);
  assert.ok(groups.every((g) => g.functionDeclarations || !(g.name && g.input_schema)), "không còn tool dạng input_schema đứng riêng");
  const names = groups[0].functionDeclarations.map((d) => d.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  assert.ok(names.includes("power_manager") && names.includes("media_control") && names.includes("desktop_manager"));
});
