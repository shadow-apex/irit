import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReminderService, OVERDUE_GRACE_MS, MAX_MINUTES } from "../../electron/main/reminders.mjs";

function harness(file, startNow = 1_000_000) {
  let t = startNow;
  const timers = new Map(); let next = 1;
  const sent = [], logs = [];
  const svc = createReminderService({
    file, now: () => t,
    notify: async (n) => { if (harness.failNotify) throw new Error("toast chết"); sent.push(n); },
    setTimer: (fn, delay) => { const id = next++; timers.set(id, { fn, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
    log: (m) => logs.push(m),
  });
  return { svc, sent, logs, timers, advance: (ms) => { t += ms; }, now: () => t };
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iris-rem-")), "reminders.json");

test("schedule → list → fire → biến mất khỏi list + file", async () => {
  const f = tmp(); const h = harness(f);
  const r = h.svc.schedule({ minutes: 10, title: "Nghỉ", message: "Uống nước" });
  assert.equal(r.success, true);
  assert.equal(h.svc.list().reminders[0].fires_in_seconds, 600);
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).length, 1);
  const [timer] = [...h.timers.values()]; assert.equal(timer.delay, 600_000);
  h.advance(600_000); await timer.fn();
  assert.deepEqual(h.sent, [{ title: "Nghỉ", message: "Uống nước" }]);
  assert.equal(h.svc.list().reminders.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).length, 0);
});
test("sống qua khởi động lại: còn hạn → đặt lại timer; quá hạn ít → bắn ngay; quá hạn > 1h → bỏ ('nhắc ma')", () => {
  const f = tmp(); const h1 = harness(f, 1_000_000);
  const a = h1.svc.schedule({ minutes: 30, title: "A", message: "a" }).id;
  const b = h1.svc.schedule({ minutes: 1, title: "B", message: "b" }).id;
  const c = h1.svc.schedule({ minutes: 1, title: "C", message: "c" }).id;
  // app tắt; mở lại sau 10 phút => B, C quá hạn 9 phút (bắn), A còn 20 phút
  const h2 = harness(f, 1_000_000 + 10 * 60_000);
  assert.deepEqual(h2.svc.load(), { restored: 1, fired: 2, dropped: 0 });
  assert.equal(h2.timers.size, 3);
  assert.equal(h2.svc.list().reminders.find((r) => r.id === a).fires_in_seconds, 20 * 60);
  // mở lại sau 5 giờ => tất cả quá hạn > 1h bị bỏ
  const h3 = harness(f, 1_000_000 + 5 * 3600_000);
  assert.deepEqual(h3.svc.load(), { restored: 0, fired: 0, dropped: 3 });
  assert.equal(h3.svc.list().reminders.length, 0);
});
test("lỗi gửi thông báo KHÔNG bị nuốt: ghi log, không giữ mục ma", async () => {
  const f = tmp(); const h = harness(f);
  h.svc.schedule({ minutes: 1, title: "X", message: "y" });
  harness.failNotify = true;
  try { await [...h.timers.values()][0].fn(); } finally { harness.failNotify = false; }
  assert.ok(h.logs.some((l) => l.includes("thất bại")));
  assert.equal(h.svc.list().reminders.length, 0);
});
test("cancel + validate đầu vào", () => {
  const h = harness(tmp());
  const id = h.svc.schedule({ minutes: 5, title: "T", message: "m" }).id;
  assert.equal(h.svc.cancel(id).success, true); assert.equal(h.timers.size, 0);
  assert.equal(h.svc.cancel("nope").success, false);
  for (const bad of [{ minutes: 0 }, { minutes: -1 }, { minutes: "abc" }, { minutes: MAX_MINUTES + 1 }, { minutes: 5, title: "", message: "m" }]) {
    assert.equal(h.svc.schedule({ title: "t", message: "m", ...bad }).success, false, JSON.stringify(bad));
  }
});
test("file hỏng không làm sập load()", () => {
  const f = tmp(); fs.writeFileSync(f, "{not json");
  assert.deepEqual(harness(f).svc.load(), { restored: 0, fired: 0, dropped: 0 });
});
test("dispose dừng timer nhưng GIỮ dữ liệu", () => {
  const f = tmp(); const h = harness(f);
  h.svc.schedule({ minutes: 5, title: "T", message: "m" }); h.svc.dispose();
  assert.equal(h.timers.size, 0); assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).length, 1);
  assert.ok(OVERDUE_GRACE_MS === 3600_000);
});
