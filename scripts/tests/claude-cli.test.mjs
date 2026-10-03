// R-03 / R-04 — chạy `claude` an toàn trên Windows và giữ UTF-8.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { buildClaudeSpawn, quoteCmdArg, windowsClaudeCandidates } from "../../electron/main/claude-spawn.mjs";

test(".exe / POSIX: chạy thẳng, KHÔNG shell, đối số nguyên vẹn (kể cả & \" % tiếng Việt)", () => {
  const nasty = ['-p', 'mở "calc" & whoami %PATH% ^ | > tiếng Việt có dấu'];
  const w = buildClaudeSpawn("C:\\Users\\a\\.local\\bin\\claude.exe", nasty, { platform: "win32" });
  assert.equal(w.command, "C:\\Users\\a\\.local\\bin\\claude.exe");
  assert.deepEqual(w.args, nasty);
  const l = buildClaudeSpawn("/usr/local/bin/claude", nasty, { platform: "linux" });
  assert.deepEqual(l.args, nasty);
});

test(".cmd + có cli.js cạnh nó: chạy `node cli.js` với ELECTRON_RUN_AS_NODE, không cmd.exe", () => {
  const spec = buildClaudeSpawn("C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd", ["-p", "a & b"], {
    platform: "win32", execPath: "C:\\iris\\iris.exe", exists: (p) => /cli\.js$/.test(p),
  });
  assert.equal(spec.command, "C:\\iris\\iris.exe");
  assert.match(spec.args[0], /@anthropic-ai[\\/]claude-code[\\/]cli\.js$/);
  assert.deepEqual(spec.args.slice(1), ["-p", "a & b"], "đối số không bị đụng tới => không injection");
  assert.equal(spec.options.env.ELECTRON_RUN_AS_NODE, "1");
});

test(".cmd không có cli.js: cmd.exe với quoting nghiêm ngặt; TỪ CHỐI đối số nguy hiểm", () => {
  const deps = { platform: "win32", exists: () => false };
  const ok = buildClaudeSpawn("C:\\n\\claude.cmd", ["-p", 'nói "xin chào"'], deps);
  assert.equal(ok.command, "cmd.exe");
  assert.deepEqual(ok.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(ok.options.windowsVerbatimArguments, true);
  assert.match(ok.args[3], /"nói ""xin chào"""/);
  for (const bad of ["a & calc", "a | b", "100%", "x ^ y", "a > b", "a < b", "dòng1\ndòng2"]) {
    assert.throws(() => buildClaudeSpawn("C:\\n\\claude.cmd", ["-p", bad], deps), /không an toàn/, bad);
  }
});

test("quoteCmdArg: nhân đôi dấu nháy", () => {
  assert.equal(quoteCmdArg('a"b'), '"a""b"');
  assert.throws(() => quoteCmdArg("%x%"));
});

test("windowsClaudeCandidates ưu tiên .exe", () => {
  const c = windowsClaudeCandidates({ USERPROFILE: "C:\\U", LOCALAPPDATA: "C:\\L", APPDATA: "C:\\A" });
  assert.ok(c[0].endsWith("claude.exe"));
  assert.ok(c.findIndex((x) => x.endsWith("claude.cmd")) > c.findIndex((x) => x.endsWith("claude.exe")));
  assert.ok(c.length >= 4);
});

test("R-04: setEncoding('utf8') ghép đúng ký tự tiếng Việt bị cắt giữa hai chunk", async () => {
  // Child ghi "Tiếng Việt ✓" thành HAI mảnh byte, cắt ngay giữa ký tự nhiều byte.
  const script = `
    const b = Buffer.from("Tiếng Việt ✓ \\n");
    const cut = b.indexOf(Buffer.from("ế")) + 1;
    process.stdout.write(b.subarray(0, cut));
    setTimeout(() => process.stdout.write(b.subarray(cut)), 60);`;
  const run = (decode) => new Promise((resolve) => {
    const c = spawn(process.execPath, ["-e", script]);
    let out = "";
    if (decode) c.stdout.setEncoding("utf8");
    c.stdout.on("data", (chunk) => { out += chunk; });
    c.on("close", () => resolve(out));
  });
  assert.match(await run(false), /\uFFFD/, "chứng minh lỗi gốc: `+=` Buffer làm hỏng ký tự");
  assert.equal((await run(true)).trim(), "Tiếng Việt ✓");
});
