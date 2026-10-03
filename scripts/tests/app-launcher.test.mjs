// S-03 — app:open / app:close không được thực thi/diệt tuỳ ý.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAppTarget, closeAppTarget, isSafeExternalUrl, processNameFor, isProtectedProcess } from "../../electron/main/app-launcher.mjs";

const desktop = fs.mkdtempSync(path.join(os.tmpdir(), "iris-desktop-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "iris-outside-"));
for (const f of ["Notepad.lnk", "Game.exe", "Site.url", "explorer.exe", "notes.txt"]) fs.writeFileSync(path.join(desktop, f), "x");
fs.writeFileSync(path.join(outside, "evil.exe"), "x");

const mkOpenDeps = () => {
  const calls = { ext: [], path: [] };
  return { calls, deps: { desktopDir: desktop, openExternal: async (u) => calls.ext.push(u), openPath: async (p) => (calls.path.push(p), "") } };
};

test("mở: chỉ http/https, từ chối scheme khác và chuỗi lệnh", async () => {
  assert.equal(isSafeExternalUrl("https://example.com/a"), true);
  assert.equal(isSafeExternalUrl("vscode://file/c:/a.txt"), true);
  for (const bad of ["ms-word:ofe|u|http://x", "file:///c:/windows/system32/cmd.exe", "javascript:alert(1)", "ms-msdt:/id", "calc.exe & whoami", ""]) {
    const { deps, calls } = mkOpenDeps();
    const r = await openAppTarget(bad, deps);
    assert.equal(r.success, false, bad);
    assert.equal(calls.ext.length + calls.path.length, 0, `không được thực thi: ${bad}`);
  }
  const { deps, calls } = mkOpenDeps();
  assert.equal((await openAppTarget("https://example.com", deps)).success, true);
  assert.deepEqual(calls.ext, ["https://example.com"]);
});

test("mở: chỉ file trên Desktop với đuôi cho phép", async () => {
  const { deps, calls } = mkOpenDeps();
  assert.equal((await openAppTarget(path.join(desktop, "Game.exe"), deps)).success, true);
  assert.equal(calls.path.length, 1);
  for (const bad of [path.join(outside, "evil.exe"), path.join(desktop, "notes.txt"), path.join(desktop, "..", "x.exe"), path.join(desktop, "nope.exe"), "cmd.exe", "calc.exe && calc", 123, null]) {
    const r = await openAppTarget(bad, deps);
    assert.equal(r.success, false, String(bad));
  }
  assert.equal(calls.path.length, 1);
});

test("đóng: dùng execFile với mảng đối số, từ chối ngoài Desktop & tiến trình hệ thống", async () => {
  const runs = [];
  const deps = { desktopDir: desktop, run: async (f, a) => runs.push([f, a]) };
  assert.equal((await closeAppTarget(path.join(desktop, "Notepad.lnk"), deps)).success, true);
  assert.deepEqual(runs[0], ["taskkill", ["/F", "/IM", "Notepad.exe"]]);
  for (const bad of [path.join(desktop, "explorer.exe"), path.join(outside, "evil.exe"), 'x" & calc & "', "explorer", "..\\..\\x.exe"]) {
    const r = await closeAppTarget(bad, deps);
    assert.equal(r.success, false, bad);
  }
  assert.equal(runs.length, 1);
});

test("processNameFor / isProtectedProcess", () => {
  assert.equal(processNameFor("C:/x/Zalo.lnk"), "Zalo.exe");
  assert.equal(processNameFor('a";calc;.exe'), null);
  assert.equal(isProtectedProcess("EXPLORER.EXE"), true);
  assert.equal(isProtectedProcess("Zalo.exe"), false);
});
