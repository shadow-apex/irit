import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickStale, cleanupScreenshots, saveScreenshot, MAX_KEEP } from "../../electron/main/screenshot-store.mjs";

test("pickStale: giữ ≤ 20 mới nhất, xoá > 24h", () => {
  const now = 10 * 86400_000;
  const e = Array.from({ length: 25 }, (_, i) => ({ name: `s${i}`, mtimeMs: now - i * 1000 }));
  assert.deepEqual(pickStale(e, now).sort(), ["s20", "s21", "s22", "s23", "s24"].sort());
  const old = [{ name: "o", mtimeMs: now - 25 * 3600_000 }, { name: "n", mtimeMs: now - 1000 }];
  assert.deepEqual(pickStale(old, now), ["o"]);
});
test("saveScreenshot ghi file và dọn thật", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iris-ss-")), "screenshots");
  const paths = [];
  for (let i = 0; i < MAX_KEEP + 3; i++) paths.push(saveScreenshot(dir, Buffer.from([0xff, 0xd8, i]), new Date(Date.now() + i * 5)));
  const left = fs.readdirSync(dir).filter((n) => n.startsWith("screenshot_"));
  assert.ok(left.length <= MAX_KEEP, `còn ${left.length}`);
  assert.ok(fs.existsSync(paths.at(-1)) && paths.at(-1).endsWith(".jpg"));
  fs.writeFileSync(path.join(dir, "note.txt"), "giữ");
  cleanupScreenshots(dir, Date.now() + 3 * 86400_000);
  assert.ok(fs.existsSync(path.join(dir, "note.txt")), "không xoá file lạ");
  assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith("screenshot_")).length, 0);
});
