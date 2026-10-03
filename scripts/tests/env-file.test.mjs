// S-10 — .env an toàn: không chèn dòng, round-trip đúng, quyền 0600, ghi atomic.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serializeConfigValue, parseEnvContent, mergeEnvLines, writeEnvFileSecure, EnvValueError } from "../../electron/main/env-file.mjs";

test("từ chối giá trị chứa xuống dòng / CR / NUL (chống chèn KEY=VALUE)", () => {
  for (const bad of ["x\nIRIS_CLAUDE_BIN=evil", "x\r\nFOO=1", "a\0b", "\nFOO=1"]) {
    assert.throws(() => serializeConfigValue(bad), EnvValueError, JSON.stringify(bad));
  }
});

test("round-trip: giá trị có \" \\ # khoảng trắng = ' tiếng Việt", () => {
  const cases = [
    'simple', 'có dấu cách', 'a"b', 'back\\slash', 'C:\\Program Files\\Iris', 'x # not a comment',
    'k=v=w', "it's", '\\"', '"', '\\', 'trailing\\', 'mix "q" and \\ and #', 'Nguyễn Văn A',
  ];
  for (const v of cases) {
    const line = `KEY=${serializeConfigValue(v)}`;
    assert.deepEqual(parseEnvContent(line), { KEY: v }, `round-trip thất bại: ${JSON.stringify(v)} -> ${line}`);
  }
});

test("giá trị rỗng, và trim đầu/cuối", () => {
  assert.equal(serializeConfigValue(""), "");
  assert.equal(serializeConfigValue(undefined), "");
  assert.equal(serializeConfigValue("  abc  "), "abc");
});

test("parseEnvContent: bỏ comment/dòng trống, hỗ trợ file cũ (nháy đơn, nháy kép có \\\")", () => {
  const parsed = parseEnvContent('# c\n\nA=1\nB="x y"\nC=\'raw \\ q\'\nD="say \\"hi\\""\nE=C:\\keep\\slashes\r\n');
  assert.deepEqual(parsed, { A: "1", B: "x y", C: "raw \\ q", D: 'say "hi"', E: "C:\\keep\\slashes" });
});

test("mergeEnvLines: giữ comment/khoá khác, thay đúng khoá, thêm khoá mới, KHÔNG sửa gì nếu có giá trị xấu", () => {
  const existing = ["# comment", "A=1", "", "B=old", "OTHER=keep"];
  const out = mergeEnvLines(existing, { B: "new value", C: "3" });
  assert.deepEqual(out, ["# comment", "A=1", "", 'B="new value"', "OTHER=keep", "C=3"]);
  assert.throws(() => mergeEnvLines(existing, { B: "ok", C: "bad\nIRIS_CLAUDE_BIN=evil" }), EnvValueError);
  assert.deepEqual(existing, ["# comment", "A=1", "", "B=old", "OTHER=keep"], "mảng gốc không bị đổi");
});

test("tấn công chèn khoá bị chặn trọn vẹn: không dòng nào được thêm", () => {
  const out = (() => { try { return mergeEnvLines(["A=1"], { IRIS_USER_NAME: "x\nIRIS_CLAUDE_BIN=evil" }); } catch { return null; } })();
  assert.equal(out, null);
});

test("writeEnvFileSecure: atomic, đúng nội dung, quyền 0600 (POSIX), không để lại .tmp", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-env-"));
  const file = path.join(dir, "sub", ".env");
  writeEnvFileSecure(file, ["A=1", 'B="x y"']);
  assert.equal(fs.readFileSync(file, "utf8"), 'A=1\nB="x y"\n');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
  // ghi đè file đã có quyền rộng => vẫn thành 0600
  fs.chmodSync(file, 0o644);
  writeEnvFileSecure(file, ["A=2"]);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith(".tmp")), []);
});
