// R-01 / R-02 / R-05 — hàng đợi Claude không được kẹt.
import test from "node:test";
import assert from "node:assert/strict";
import { createRunQueue, RUN_STATUS, defaultRunTimeoutMs, MAX_TERMINAL_RUNS, MAX_OUTPUT_CHARS } from "../../electron/run-queue.mjs";

const mkRun = (id) => ({ run_id: id, workstream_id: "w", session_label: "s", task: `task ${id}`, urgency: "normal", agent: null, status: RUN_STATUS.QUEUED, output: "", activity: [], queued_at: 0, child: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("R-01: startRun ném đồng bộ => run 'error' và task kế tiếp VẪN chạy", () => {
  const started = [];
  const events = [];
  const q = createRunQueue({
    emit: (e) => events.push(e),
    getTimeoutMs: () => 0,
    startRun: (run) => {
      started.push(run.run_id);
      if (run.run_id === "a") throw new Error("boom");
    },
  });
  q.submit(mkRun("a"));
  q.submit(mkRun("b"));
  assert.equal(q.status("a"), RUN_STATUS.ERROR);
  assert.deepEqual(started, ["a", "b"]);
  assert.match(q.get("a").output, /Start failed: boom/);
  // b đang giữ slot; hoàn tất b thì c chạy được
  q.submit(mkRun("c"));
  q.finalize("b", RUN_STATUS.COMPLETED, "ok");
  assert.deepEqual(started, ["a", "b", "c"]);
});

test("R-01: startRun trả Promise bị reject => finalize error, queue không kẹt", async () => {
  const started = [];
  const q = createRunQueue({
    emit: () => {},
    getTimeoutMs: () => 0,
    startRun: async (run) => { started.push(run.run_id); if (run.run_id === "a") throw new Error("async boom"); },
  });
  q.submit(mkRun("a"));
  q.submit(mkRun("b"));
  await sleep(10);
  assert.equal(q.status("a"), RUN_STATUS.ERROR);
  assert.deepEqual(started, ["a", "b"]);
});

test("watchdog: run quá hạn bị finalize FAILED 'Timed out' và task kế tiếp chạy", async () => {
  const started = [];
  const interrupted = [];
  const q = createRunQueue({
    emit: () => {},
    getTimeoutMs: () => 60,
    interruptRun: (r) => interrupted.push(r.run_id),
    startRun: (run) => { started.push(run.run_id); }, // không bao giờ finalize
  });
  q.submit(mkRun("a"));
  q.submit(mkRun("b"));
  await sleep(120);
  assert.equal(q.status("a"), RUN_STATUS.FAILED);
  assert.match(q.get("a").output, /Timed out/);
  assert.deepEqual(interrupted.includes("a"), true);
  assert.deepEqual(started.slice(0, 2), ["a", "b"]);
  q.finalize("b", RUN_STATUS.COMPLETED, "ok");
});

test("watchdog tắt khi timeout = 0; defaultRunTimeoutMs đọc env", () => {
  assert.equal(defaultRunTimeoutMs({}), 30 * 60_000);
  assert.equal(defaultRunTimeoutMs({ IRIS_RUN_TIMEOUT_MS: "0" }), 0);
  assert.equal(defaultRunTimeoutMs({ IRIS_RUN_TIMEOUT_MS: "5000" }), 5000);
  assert.equal(defaultRunTimeoutMs({ IRIS_RUN_TIMEOUT_MS: "abc" }), 30 * 60_000);
});

test("R-02: stop() run đang chạy KHÔNG có tiến trình con (PO/STUDY) => ngắt turn + finalize CANCELLED, nhả slot", () => {
  const started = [];
  const interrupted = [];
  const q = createRunQueue({
    emit: () => {}, getTimeoutMs: () => 0,
    interruptRun: (r) => interrupted.push(r.run_id),
    startRun: (run) => { started.push(run.run_id); run.status = RUN_STATUS.RUNNING; },
  });
  q.submit(mkRun("po1"));
  q.submit(mkRun("next"));
  q.stop("po1");
  assert.deepEqual(interrupted, ["po1"]);
  assert.equal(q.status("po1"), RUN_STATUS.CANCELLED);
  assert.deepEqual(started, ["po1", "next"], "slot phải được nhả cho task kế tiếp");
});

test("finalize chỉ một lần; onFinalized ném lỗi không làm kẹt queue", () => {
  const started = [];
  const q = createRunQueue({
    emit: () => {}, getTimeoutMs: () => 0,
    onFinalized: () => { throw new Error("announce failed"); },
    startRun: (run) => started.push(run.run_id),
  });
  q.submit(mkRun("a")); q.submit(mkRun("b"));
  q.finalize("a", RUN_STATUS.COMPLETED, "x");
  q.finalize("a", RUN_STATUS.FAILED, "y");
  assert.equal(q.status("a"), RUN_STATUS.COMPLETED);
  assert.deepEqual(started, ["a", "b"]);
});

test("dọn bộ nhớ: giữ tối đa 100 run terminal, output <= 20KB", () => {
  const q = createRunQueue({ emit: () => {}, getTimeoutMs: () => 0, startRun: () => {} });
  for (let i = 0; i < MAX_TERMINAL_RUNS + 30; i++) {
    q.submit(mkRun(`r${i}`));
    q.finalize(`r${i}`, RUN_STATUS.COMPLETED, "x".repeat(i === 5 ? MAX_OUTPUT_CHARS * 3 : 10));
  }
  assert.equal(q.list().length, MAX_TERMINAL_RUNS);
  assert.equal(q.get("r0"), null, "run cũ nhất bị xoá");
  assert.ok(q.get(`r${MAX_TERMINAL_RUNS + 29}`));
});

test("activeRunId phản ánh run đang giữ slot (trước đây /status luôn 'Idle')", () => {
  const q = createRunQueue({ emit: () => {}, getTimeoutMs: () => 0, startRun: () => {} });
  assert.equal(q.activeRunId(), null);
  q.submit(mkRun("a"));
  assert.equal(q.activeRunId(), "a");
  q.finalize("a", RUN_STATUS.COMPLETED, "ok");
  assert.equal(q.activeRunId(), null);
});
