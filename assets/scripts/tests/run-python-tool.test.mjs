// Chạy runPythonTool THẬT, dùng `node` làm "python" và thư mục tools giả (IRIS_PYTHON_BIN / IRIS_TOOLS_DIR).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPythonTool, pythonEnv, MAX_STDOUT_BYTES, findMatchInCachedOcr, invalidateOcrCache, formatActiveWindowSummary, DAEMON_ELIGIBLE_TOOLS } from "../../../electron/main/local-tools.mjs";
import { buildToolResponse } from "../../../electron/main/tool-result.mjs";
import { isNoiseOrFillerTranscript, buildLiveConfig } from "../../../electron/main/gemini-live.mjs";
import { getToolStatusLabel } from "../../../electron/main/tool-dispatcher.mjs";

let dir;
const prev = { py: process.env.IRIS_PYTHON_BIN, td: process.env.IRIS_TOOLS_DIR };
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-tools-"));
  const w = (n, c) => fs.writeFileSync(path.join(dir, n), c);
  w("echo.js", `process.stdin.resume();let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{console.log(JSON.stringify({success:true,argv:process.argv.slice(2),stdin:d,utf8:process.env.PYTHONUTF8,io:process.env.PYTHONIOENCODING,self:process.env.IRIS_SELF_PID,ud:!!process.env.IRIS_USER_DATA}))})`);
  w("fail.js", `console.log(JSON.stringify({success:false,error:"hỏng rồi"}));process.exit(1)`);
  w("fail0.js", `console.log(JSON.stringify({success:false,error:"lỗi nhưng exit 0"}))`);
  w("noerr.js", `console.log(JSON.stringify({error:"không có success"}))`);
  w("vn.js", `const s="Tiếng Việt: ".concat("ệ".repeat(60000));const b=Buffer.from(JSON.stringify({success:true,s}),"utf8");for(let i=0;i<b.length;i+=7){process.stdout.write(b.subarray(i,i+7))}`);
  w("hang.js", `setInterval(()=>{},1000)`);
  w("big.js", `process.stdout.write("x".repeat(${MAX_STDOUT_BYTES * 2}))`);
  process.env.IRIS_PYTHON_BIN = process.execPath;
  process.env.IRIS_TOOLS_DIR = dir;
});
after(() => {
  for (const [k, v] of [["IRIS_PYTHON_BIN", prev.py], ["IRIS_TOOLS_DIR", prev.td]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("env UTF-8 + PID của Iris + argv rời + stdin", async () => {
  const run = await runPythonTool("echo.js", ["--text=-5", "a b"], { stdin: "xin chào ệ" });
  assert.equal(run.ok, true);
  const r = buildToolResponse(run);
  assert.equal(r.status, "success");
  assert.deepEqual(r.argv, ["--text=-5", "a b"]);
  assert.equal(r.stdin, "xin chào ệ");
  assert.equal(r.utf8, "1"); assert.equal(r.io, "utf-8"); assert.equal(r.self, String(process.pid)); assert.equal(r.ud, true);
});
test("script thất bại (exit 1) => status error + thông điệp thật", async () => {
  const r = buildToolResponse(await runPythonTool("fail.js"));
  assert.equal(r.status, "error"); assert.equal(r.error, "hỏng rồi");
});
test("script in success:false nhưng exit 0 => vẫn error (TL-03)", async () => {
  const r = buildToolResponse(await runPythonTool("fail0.js"));
  assert.equal(r.status, "error"); assert.equal(r.error, "lỗi nhưng exit 0");
});
test("script in {error} không có success => error (power_manager/media_control cũ)", async () => {
  assert.equal(buildToolResponse(await runPythonTool("noerr.js")).status, "error");
});
test("ký tự nhiều byte KHÔNG vỡ khi chunk cắt giữa chừng (TL-14/R-04)", async () => {
  const r = buildToolResponse(await runPythonTool("vn.js"));
  assert.equal(r.status, "success");
  assert.ok(r.s.startsWith("Tiếng Việt: ệ"));
  assert.equal(r.s.includes("\uFFFD"), false);
  assert.equal(r.s.length, "Tiếng Việt: ".length + 60000);
});
test("hết giờ => killTree + onTimeout được gọi (nhả chuột)", async () => {
  let cleaned = false;
  const t0 = Date.now();
  const run = await runPythonTool("hang.js", [], { timeoutMs: 400, onTimeout: async () => { cleaned = true; } });
  assert.equal(run.ok, false); assert.equal(run.timedOut, true); assert.ok(cleaned);
  assert.ok(Date.now() - t0 < 4000);
  assert.equal(buildToolResponse(run).status, "error");
});
test("stdout > 1 MB bị cắt và báo lỗi", async () => {
  const run = await runPythonTool("big.js", [], { timeoutMs: 8000 });
  assert.equal(run.ok, false);
  assert.ok(run.stdout.length <= MAX_STDOUT_BYTES);
  assert.match(run.error, /vượt/);
});
test("file không tồn tại => error, không treo", async () => {
  const run = await runPythonTool("khong-co.js", [], { timeoutMs: 5000 });
  assert.equal(buildToolResponse(run).status, "error");
});
test("IRIS_PYTHON_BIN/IRIS_TOOLS_DIR đọc LƯỜI mỗi lần gọi (P-03)", async () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "iris-tools2-"));
  fs.writeFileSync(path.join(dir2, "echo.js"), `console.log(JSON.stringify({success:true,where:"dir2"}))`);
  process.env.IRIS_TOOLS_DIR = dir2;
  try {
    assert.equal(buildToolResponse(await runPythonTool("echo.js")).where, "dir2");
  } finally {
    process.env.IRIS_TOOLS_DIR = dir;
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});
test("pythonEnv chứa các biến bắt buộc", () => {
  const e = pythonEnv({ X: "1" });
  assert.equal(e.PYTHONUTF8, "1"); assert.equal(e.X, "1"); assert.ok(e.IRIS_SCREENSHOT_DIR.endsWith("screenshots"));
});
test("isNoiseOrFillerTranscript lọc tiếng thở dài, cười, từ đệm vô nghĩa và giữ lại khẩu lệnh", () => {
  assert.equal(isNoiseOrFillerTranscript("ờ"), true);
  assert.equal(isNoiseOrFillerTranscript("ừm..."), true);
  assert.equal(isNoiseOrFillerTranscript("hmm"), true);
  assert.equal(isNoiseOrFillerTranscript("..."), true);
  assert.equal(isNoiseOrFillerTranscript("[noise]"), true);
  assert.equal(isNoiseOrFillerTranscript("(tiếng cười)"), true);
  assert.equal(isNoiseOrFillerTranscript("mở Chrome"), false);
  assert.equal(isNoiseOrFillerTranscript("Iris ơi chụp màn hình"), false);
});
test("buildLiveConfig chứa giao thức STRICT ANTI-CHIME-IN và ULTRA-CONCISE VOICE", () => {
  const cfg = buildLiveConfig();
  const sysText = cfg.systemInstruction.parts[0].text;
  assert.ok(sysText.includes("STRICT ANTI-CHIME-IN"));
  assert.ok(sysText.includes("WHEN IN DOUBT -> REMAIN SILENT"));
  assert.ok(sysText.includes("TRIGGER CONDITION"));
  assert.ok(sysText.includes("ULTRA-CONCISE VOICE"));
});
test("findMatchInCachedOcr & getToolStatusLabel hoạt động chính xác", () => {
  invalidateOcrCache();
  const cached = {
    words: [
      { text: "Submit", x: 100, y: 200, w: 60, h: 20 },
      { text: "Form", x: 170, y: 200, w: 50, h: 20 },
    ],
    lines: [{ text: "Submit Form" }],
  };
  const m1 = findMatchInCachedOcr(cached, "submit");
  assert.equal(m1.found, true);
  assert.equal(m1.matched_text, "Submit");
  assert.deepEqual(m1.center, [130, 210]);
  const m2 = findMatchInCachedOcr(cached, "submit form");
  assert.equal(m2.found, true);
  assert.equal(m2.matched_text, "Submit Form");
  const m3 = findMatchInCachedOcr(cached, "cancel");
  assert.equal(m3.found, false);
  assert.ok(getToolStatusLabel("ocr_region", { find: "Save" }).includes("Save"));
  assert.ok(getToolStatusLabel("universal_app_launcher", { query: "Chrome" }).includes("Chrome"));
});
test("formatActiveWindowSummary & DAEMON_ELIGIBLE_TOOLS hoạt động chính xác", () => {
  assert.ok(DAEMON_ELIGIBLE_TOOLS.has("mouse_control.py"));
  assert.ok(DAEMON_ELIGIBLE_TOOLS.has("active_window_info.py"));
  assert.ok(DAEMON_ELIGIBLE_TOOLS.has("ocr_region.py"));
  assert.equal(formatActiveWindowSummary(null), "");
  assert.equal(formatActiveWindowSummary({}), "");
  assert.equal(
    formatActiveWindowSummary({ title: "YouTube - Chrome", process_name: "chrome.exe" }),
    '[Cửa sổ đang mở: "YouTube - Chrome" (chrome.exe)]',
  );
  assert.equal(
    formatActiveWindowSummary({ title: "Notepad", process_name: "notepad" }),
    '[Cửa sổ đang mở: "Notepad"]',
  );
});
