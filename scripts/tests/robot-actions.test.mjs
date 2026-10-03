// F-01 / T-03 — phía Node của điều khiển robot.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-cfg-"));
process.env.IRIS_CONFIG_DIR = dir;

const { resetDeviceConfigCache } = await import("../../electron/main/device-config.mjs");
const ra = await import("../../electron/main/robot-actions.mjs");

const received = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ auth: req.headers.authorization, body: JSON.parse(body || "{}"), t: Date.now() });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

fs.writeFileSync(
  path.join(dir, "robots.json"),
  JSON.stringify({ robots: { bot: { name: "Bot", control_url: `http://127.0.0.1:${port}/control`, token: "tok-123" }, nocfg: { name: "NoCfg" } } }),
);
resetDeviceConfigCache();

test.after(() => { ra.cancelAllTimedDrives(); server.close(); server.closeAllConnections?.(); });

test("normalizeRobotAction ánh xạ alias sang động từ firmware", () => {
  for (const [a, b] of [["move_forward", "forward"], ["turn_left", "left"], ["Turn Right", "right"], ["move-back", "backward"], ["halt", "stop"], ["arm_move", "arm_move"]]) {
    assert.equal(ra.normalizeRobotAction(a), b);
  }
});

test("lệnh gửi kèm Bearer token và action đã chuẩn hoá", async () => {
  received.length = 0;
  const r = await ra.triggerRobotAction({ robot_id: "bot", action: "move_forward" });
  assert.equal(r.status, "success");
  assert.equal(received[0].auth, "Bearer tok-123");
  assert.equal(received[0].body.action, "forward");
  await ra.triggerRobotAction({ robot_id: "bot", action: "stop" });
});

test("lái có thời hạn: heartbeat <=300ms rồi TỰ gửi stop", async () => {
  received.length = 0;
  const r = await ra.triggerRobotActionTimed({ robot_id: "bot", action: "turn_left", params: { duration_ms: 700 } });
  assert.equal(r.status, "success");
  await new Promise((res) => setTimeout(res, 1300));
  const actions = received.map((x) => x.body.action);
  assert.equal(actions[0], "left");
  assert.equal(actions.at(-1), "stop", `chuỗi lệnh: ${actions.join(",")}`);
  const drives = received.filter((x) => x.body.action === "left");
  assert.ok(drives.length >= 3, "phải có heartbeat lặp");
  for (let i = 1; i < drives.length; i++) assert.ok(drives[i].t - drives[i - 1].t <= 400, "khoảng cách heartbeat quá lớn");
});

test("stop huỷ lái có thời hạn đang chạy", async () => {
  received.length = 0;
  await ra.triggerRobotActionTimed({ robot_id: "bot", action: "forward", params: { duration_ms: 4000 } });
  await ra.triggerRobotAction({ robot_id: "bot", action: "stop" });
  const n = received.length;
  await new Promise((res) => setTimeout(res, 600));
  assert.equal(received.length, n, "không được còn lệnh nào sau stop");
});

test("duration bị kẹp tối đa 5 s", async () => {
  const r = await ra.triggerRobotActionTimed({ robot_id: "bot", action: "forward", params: { duration_ms: 999999 } });
  assert.match(r.message, /5000 ms/);
  await ra.triggerRobotAction({ robot_id: "bot", action: "stop" });
});

test("T-03: thiếu control_url => not_configured, KHÔNG phải success", async () => {
  const r = await ra.triggerRobotAction({ robot_id: "nocfg", action: "forward" });
  assert.equal(r.status, "not_configured");
  delete process.env.SMART_HOME_WEBHOOK_URL;
  const s = await ra.triggerSmartHome({ device: "đèn lạ", action: "on" });
  assert.equal(s.status, "not_configured");
});

test("device-config: fallback sang .example.json và cảnh báo khi JSON hỏng", async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "iris-cfg2-"));
  fs.writeFileSync(path.join(d2, "robots.example.json"), JSON.stringify({ robots: { ex: { name: "Ex" } } }));
  process.env.IRIS_CONFIG_DIR = d2;
  const dc = await import("../../electron/main/device-config.mjs");
  const warns = [];
  dc.setConfigWarningHandler((m) => warns.push(m));
  dc.resetDeviceConfigCache();
  assert.ok(dc.getRobotsConfig().ex);
  assert.ok(warns.some((w) => /example/.test(w)));
  fs.writeFileSync(path.join(d2, "robots.json"), "{ broken");
  dc.resetDeviceConfigCache();
  assert.deepEqual(dc.getRobotsConfig(), {});
  assert.ok(warns.some((w) => /Không đọc được robots.json/.test(w)));
  process.env.IRIS_CONFIG_DIR = dir;
  dc.resetDeviceConfigCache();
});
