// T-01 — lỗi toàn cục được ghi log có xoay vòng; lỗi lúc khởi động không bị nuốt.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createFileLogger, installGlobalErrorHandlers, describeError } from "../../electron/main/crash-log.mjs";

test("ghi log và xoay vòng khi vượt kích thước", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-log-"));
  const log = createFileLogger(path.join(dir, "logs"), { maxBytes: 200, keep: 2 });
  for (let i = 0; i < 30; i++) log.write("info", `dòng số ${i} `.padEnd(40, "x"));
  const files = fs.readdirSync(path.join(dir, "logs")).sort();
  assert.ok(files.includes("main.log") && files.includes("main.log.1"), files.join(","));
  assert.ok(files.length <= 4, "số file giữ lại bị giới hạn");
  assert.match(fs.readFileSync(log.file, "utf8"), /\[info\] dòng số 29/);
});

test("uncaughtException trước khi ready => ghi log và THOÁT; sau khi ready => giữ app", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-log2-"));
  const logger = createFileLogger(dir);
  const proc = new EventEmitter();
  let ready = false; const exits = []; const reported = [];
  installGlobalErrorHandlers({ logger, isReady: () => ready, exit: (c) => exits.push(c), proc, onError: (k, m) => reported.push(k) });
  proc.emit("uncaughtException", new Error("khởi động hỏng"));
  assert.deepEqual(exits, [1]);
  ready = true;
  proc.emit("uncaughtException", new Error("lỗi tính năng phụ"));
  assert.deepEqual(exits, [1], "sau khi ready không thoát");
  proc.emit("unhandledRejection", new Error("promise hỏng"));
  assert.deepEqual(reported, ["uncaughtException", "uncaughtException", "unhandledRejection"]);
  const text = fs.readFileSync(logger.file, "utf8");
  assert.match(text, /khởi động hỏng/); assert.match(text, /promise hỏng/);
});

test("describeError xử lý giá trị không phải Error", () => {
  assert.match(describeError("x"), /x/);
  assert.match(describeError({ a: 1 }), /"a":1/);
  assert.ok(describeError(new Error("e")).includes("e"));
});
