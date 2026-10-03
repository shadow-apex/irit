// E-02 — JSON hỏng không bị ghi đè; ghi atomic.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonOrQuarantine, writeFileAtomicSync } from "../../electron/atomic-file.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-atomic-"));

test("file không tồn tại => fallback, không cách ly", () => {
  const r = readJsonOrQuarantine(path.join(dir, "none.json"), []);
  assert.deepEqual(r, { value: [], quarantinedTo: null, error: null });
});

test("file hỏng (cụt) => cách ly, byte còn nguyên, lần ghi sau không xoá dữ liệu cũ", () => {
  const f = path.join(dir, "rules.json");
  fs.writeFileSync(f, '[{"id":"r1","name":"Bật đèn lúc 6h"},{"id":"r2"'); // cụt giữa chừng
  const r = readJsonOrQuarantine(f, []);
  assert.deepEqual(r.value, []);
  assert.ok(r.error && r.quarantinedTo);
  assert.equal(fs.existsSync(f), false, "file gốc đã được dời đi");
  assert.match(fs.readFileSync(r.quarantinedTo, "utf8"), /Bật đèn lúc 6h/, "dữ liệu cũ còn nguyên để khôi phục");
  writeFileAtomicSync(f, "[]");
  assert.equal(fs.readFileSync(f, "utf8"), "[]");
  assert.ok(fs.existsSync(r.quarantinedTo), "bản cách ly không bị ghi đè");
});

test("đọc JSON hợp lệ (kể cả có BOM)", () => {
  const f = path.join(dir, "ok.json");
  fs.writeFileSync(f, "\uFEFF" + JSON.stringify({ a: 1 }));
  assert.deepEqual(readJsonOrQuarantine(f, null).value, { a: 1 });
});

test("ghi atomic không để lại .tmp", () => {
  const f = path.join(dir, "a.json");
  writeFileAtomicSync(f, "x");
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")), []);
});
