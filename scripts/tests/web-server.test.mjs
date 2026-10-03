// S-09 — Web dashboard phải an toàn theo mặc định.
import test from "node:test";
import assert from "node:assert/strict";
import { initWebServer, validateWebPassword, passwordsMatch } from "../../electron/web-server.mjs";

const GOOD = "correct-horse-battery";
const mkCallbacks = () => {
  const calls = { submit: [], gemini: [], logs: [] };
  return {
    calls,
    cb: {
      submitTask: (a) => calls.submit.push(a),
      sendToGemini: (t) => calls.gemini.push(t),
      getStatus: () => "Idle",
      log: (level, msg) => calls.logs.push([level, msg]),
    },
  };
};
const envOf = (over = {}) => ({
  IRIS_WEB_DASHBOARD: "1",
  WEB_PASSWORD: GOOD,
  WEB_PORT: "0",
  IRIS_WEB_BIND: "127.0.0.1",
  ...over,
});
const base = (s) => `http://127.0.0.1:${s.server.address().port}`;
const close = (s) => new Promise((r) => { s.server.closeAllConnections?.(); s.server.close(() => r()); });

test("validateWebPassword từ chối rỗng / iris123 / ngắn", () => {
  assert.equal(validateWebPassword("").ok, false);
  assert.equal(validateWebPassword(undefined).ok, false);
  assert.equal(validateWebPassword("iris123").ok, false);
  assert.equal(validateWebPassword("IRIS123").ok, false);
  assert.equal(validateWebPassword("short-pw").ok, false);
  assert.equal(validateWebPassword(GOOD).ok, true);
});

test("passwordsMatch hằng-thời-gian đúng/sai, không ném với độ dài khác nhau", () => {
  assert.equal(passwordsMatch(GOOD, GOOD), true);
  assert.equal(passwordsMatch("x", GOOD), false);
  assert.equal(passwordsMatch(undefined, GOOD), false);
});

for (const [name, env] of [
  ["IRIS_WEB_DASHBOARD không bật", envOf({ IRIS_WEB_DASHBOARD: undefined })],
  ["WEB_PASSWORD rỗng", envOf({ WEB_PASSWORD: "" })],
  ["WEB_PASSWORD = iris123", envOf({ WEB_PASSWORD: "iris123" })],
  ["WEB_PASSWORD < 12 ký tự", envOf({ WEB_PASSWORD: "abc" })],
]) {
  test(`KHÔNG listen khi ${name}`, async () => {
    const { cb } = mkCallbacks();
    const send = initWebServer(cb, env);
    assert.equal(send.enabled, false);
    assert.equal(send.server, undefined);
    assert.equal(await send.ready, false);
    assert.doesNotThrow(() => send("x")); // no-op an toàn
  });
}

test("mặc định bind 127.0.0.1", async () => {
  const { cb } = mkCallbacks();
  const s = initWebServer(cb, envOf({ IRIS_WEB_BIND: undefined }));
  assert.equal(await s.ready, true);
  assert.equal(s.server.address().address, "127.0.0.1");
  await close(s);
});

test("sai mật khẩu => 401 và KHÔNG gọi submitTask; ?password= bị bỏ qua", async () => {
  const { cb, calls } = mkCallbacks();
  const s = initWebServer(cb, envOf());
  await s.ready;
  const json = { "Content-Type": "application/json" };

  let r = await fetch(`${base(s)}/api/task`, { method: "POST", headers: { ...json, "x-password": "nope" }, body: JSON.stringify({ task: "rm -rf" }) });
  assert.equal(r.status, 401);
  r = await fetch(`${base(s)}/api/task`, { method: "POST", headers: json, body: JSON.stringify({ task: "x" }) });
  assert.equal(r.status, 401);
  // mật khẩu đúng nhưng trên query string => vẫn 401
  r = await fetch(`${base(s)}/api/status?password=${GOOD}`);
  assert.equal(r.status, 401);
  r = await fetch(`${base(s)}/api/stream?password=${GOOD}`);
  assert.equal(r.status, 401);
  assert.equal(calls.submit.length, 0);
  await close(s);
});

test("mật khẩu đúng qua header => nhận task hợp lệ, từ chối đầu vào xấu", async () => {
  const { cb, calls } = mkCallbacks();
  const s = initWebServer(cb, envOf());
  await s.ready;
  const h = { "Content-Type": "application/json", "x-password": GOOD };

  let r = await fetch(`${base(s)}/api/task`, { method: "POST", headers: h, body: JSON.stringify({ task: " mở youtube ", agent: "dev" }) });
  assert.equal(r.status, 200);
  assert.deepEqual(calls.submit, [{ task: "mở youtube", agent: "dev" }]);

  r = await fetch(`${base(s)}/api/task`, { method: "POST", headers: h, body: JSON.stringify({ task: "x", agent: "root" }) });
  assert.equal(r.status, 400);
  r = await fetch(`${base(s)}/api/task`, { method: "POST", headers: h, body: JSON.stringify({ task: 123 }) });
  assert.equal(r.status, 400);
  r = await fetch(`${base(s)}/api/task`, { method: "POST", headers: h, body: JSON.stringify({ task: "a".repeat(4001) }) });
  assert.equal(r.status, 400);
  r = await fetch(`${base(s)}/api/task`, { method: "POST", headers: h, body: JSON.stringify({ task: "a".repeat(40_000) }) });
  assert.ok(r.status === 413 || r.status === 400);
  assert.equal(calls.submit.length, 1);

  r = await fetch(`${base(s)}/api/gemini`, { method: "POST", headers: h, body: JSON.stringify({ text: "xin chào" }) });
  assert.equal(r.status, 200);
  assert.deepEqual(calls.gemini, ["xin chào"]);
  await close(s);
});

test("5 lần sai => khoá (429), kể cả sau đó nhập đúng", async () => {
  const { cb, calls } = mkCallbacks();
  const s = initWebServer(cb, envOf());
  await s.ready;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${base(s)}/api/status`, { headers: { "x-password": `bad${i}` } });
    assert.equal(r.status, 401);
  }
  const locked = await fetch(`${base(s)}/api/status`, { headers: { "x-password": GOOD } });
  assert.equal(locked.status, 429);
  assert.equal(calls.submit.length, 0);
  await close(s);
});
