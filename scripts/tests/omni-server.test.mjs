// S-01 (phía Node): header X-Iris-Token, không spawn khi server ở host khác.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const seen = [];
const fake = http.createServer((req, res) => {
  seen.push({ url: req.url, token: req.headers["x-iris-token"] });
  const ok = req.headers["x-iris-token"] === process.env.IRIS_OMNI_TOKEN;
  res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
  res.end(ok ? '{"status":"ok"}' : '{"error":"unauthorized"}');
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
process.env.IRIS_OMNI_TOKEN = "unit-test-token-0123456789";
process.env.OMNIPARSER_API_URL = `http://127.0.0.1:${fake.address().port}/parse`;
const om = await import("../../electron/main/omni-server.mjs");
test.after(() => { om.stopOmniServer(); fake.close(); fake.closeAllConnections?.(); });

test("omniAuthHeaders dùng IRIS_OMNI_TOKEN nếu có và gộp header phụ", () => {
  const h = om.omniAuthHeaders({ "Content-Type": "application/json" });
  assert.equal(h["X-Iris-Token"], "unit-test-token-0123456789");
  assert.equal(h["Content-Type"], "application/json");
});

test("ensureOmniServer: /health có token => true, không spawn thêm", async () => {
  assert.equal(await om.ensureOmniServer({ timeoutMs: 3000 }), true);
  assert.ok(seen.some((s) => s.url === "/health" && s.token === process.env.IRIS_OMNI_TOKEN));
});

test("OMNIPARSER_ENABLED=false => false, không gọi mạng", async () => {
  const n = seen.length;
  process.env.OMNIPARSER_ENABLED = "false";
  assert.equal(await om.ensureOmniServer(), false);
  assert.equal(seen.length, n);
  delete process.env.OMNIPARSER_ENABLED;
});

test("token tự sinh đủ dài khi không cấu hình", async () => {
  const saved = process.env.IRIS_OMNI_TOKEN;
  delete process.env.IRIS_OMNI_TOKEN;
  assert.ok(om.omniToken().length >= 32);
  process.env.IRIS_OMNI_TOKEN = saved;
});
