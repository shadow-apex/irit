// Test "gác cổng" — chặn các lớp lỗi đã gặp quay lại: IPC lệch hợp đồng, phiên bản "latest",
// mojibake/BOM, file rác, bí mật trong repo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "reponew", ".iris-data"].includes(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

test("IPC contract: mỗi kênh preload gọi (invoke/send) đều có handler ở main", () => {
  const preload = read("electron/preload.cjs");
  const used = new Set();
  for (const m of preload.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*["'`]([^"'`]+)["'`]/g)) used.add(m[1]);

  const mainSources = [...walk("electron", [".mjs"])].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  const handled = new Set();
  for (const m of mainSources.matchAll(/ipcMain\.(?:handle|on|once)\(\s*["'`]([^"'`]+)["'`]/g)) handled.add(m[1]);
  // electron/capabilities/*.mjs đăng ký theo dạng { channel: "x:y", kind: "handle"|"on", fn }
  for (const m of mainSources.matchAll(/channel:\s*["'`]([^"'`]+)["'`]/g)) handled.add(m[1]);

  const missing = [...used].filter((c) => !handled.has(c)).sort();
  assert.deepEqual(missing, [], `preload gọi kênh KHÔNG có handler: ${missing.join(", ")}`);
});

test("IPC contract: mọi API preload có kiểu khai báo trong vite-env.d.ts", () => {
  const preload = read("electron/preload.cjs");
  const dts = read("src/vite-env.d.ts");
  // tên thuộc tính cấp 1 của contextBridge.exposeInMainWorld("iris", { ... })
  const body = preload.slice(preload.indexOf('exposeInMainWorld("iris"'));
  const names = new Set([...body.matchAll(/^  ([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
  const untyped = [...names].filter((n) => !new RegExp(`\\b${n}\\??:`).test(dts)).sort();
  assert.deepEqual(untyped, [], `preload expose nhưng d.ts thiếu kiểu: ${untyped.join(", ")}`);
});

test("package.json: không còn 'latest', không có gói `tsc` giả, windows-media-sessions là optional", () => {
  const pkg = JSON.parse(read("package.json"));
  const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  const latest = Object.entries(all).filter(([, v]) => v === "latest" || v === "*").map(([k]) => k);
  assert.deepEqual(latest, [], `phiên bản chưa ghim: ${latest.join(", ")}`);
  assert.equal(pkg.dependencies.tsc, undefined, "gói npm `tsc` (không phải TypeScript) ghi đè bin tsc");
  assert.ok(all.typescript, "thiếu typescript");
  assert.equal(pkg.dependencies["windows-media-sessions"], undefined);
  assert.ok(pkg.optionalDependencies["windows-media-sessions"]);
});

test("@mediapipe/tasks-vision ghim cứng và khớp URL WASM trong useHandControl", () => {
  const pkg = JSON.parse(read("package.json"));
  const v = pkg.dependencies["@mediapipe/tasks-vision"];
  assert.match(v, /^\d+\.\d+\.\d+$/, `phải ghim cứng (không ^/~): ${v}`);
  assert.ok(read("src/hooks/useHandControl.ts").includes(`tasks-vision@${v}/wasm`), "URL WASM CDN lệch phiên bản ghim");
});

test("package.json build.files / extraResources không trỏ tới đường dẫn không tồn tại", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const e of pkg.build.extraResources || []) {
    assert.ok(fs.existsSync(path.join(root, e.from)), `extraResources.from không tồn tại: ${e.from}`);
  }
  for (const f of pkg.build.files || []) {
    if (/[*!]/.test(f)) continue; // glob: bỏ qua
    if (f === "package.json") continue;
    assert.ok(fs.existsSync(path.join(root, f)), `build.files không tồn tại: ${f}`);
  }
  assert.equal(pkg.build.win.requestedExecutionLevel, "asInvoker");
});

test("mã hoá: không BOM, không mojibake trong mã nguồn electron/ src/ scripts/", () => {
  const files = [...walk("electron", [".mjs", ".cjs", ".html"]), ...walk("src", [".ts", ".tsx", ".css"]), ...walk("scripts", [".mjs"])];
  const bom = [], moji = [];
  for (const f of files) {
    if (f.includes(path.join("scripts", "tests"))) continue; // test chứa chuỗi mẫu để so khớp
    const buf = fs.readFileSync(path.join(root, f));
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bom.push(f);
    const text = buf.toString("utf8");
    // chuỗi UTF-8 bị đọc nhầm Windows-1252: "â€" / "Ã" + ký tự / "Ä" + ký tự đặc trưng
    if (/â€[™œ\u009d"“”¦˜]|Ã[\u00a0-\u00bf]|Ä[\u0090\u0091\u00a9\u00ab]|áº[\u00a0-\u00bf]|á»[\u00a0-\u00bf]/.test(text)) moji.push(f);
  }
  assert.deepEqual(bom, [], `file có BOM: ${bom.join(", ")}`);
  assert.deepEqual(moji, [], `file nghi mojibake: ${moji.join(", ")}`);
});

test("không còn file rác / ảnh chụp / transcript / bí mật trong repo", () => {
  for (const f of ["patch.js", "patch.cjs", "test-config.mjs", "test-syntax.mjs", "test-gemini.mjs", "print_diff.py", "diff_output.txt", "remove_tools.py", "test.png", "robots.json", "smarthome_cameras.json"]) {
    assert.equal(fs.existsSync(path.join(root, f)), false, `file không được có mặt: ${f}`);
  }
  assert.equal(fs.existsSync(path.join(root, "teleprompter_logs")), false);
  assert.equal(fs.existsSync(path.join(root, "scratch")), false);
  const shots = walk("tools", [".png", ".jpg"]);
  assert.deepEqual(shots, [], "ảnh chụp màn hình thật trong tools/");
  assert.ok(fs.existsSync(path.join(root, "robots.example.json")));
  const ex = JSON.parse(read("robots.example.json"));
  for (const r of Object.values(ex.robots || {})) assert.ok(!r.token, "robots.example.json không được chứa token");
});

test(".env.example: không còn marker xung đột, không có khoá/token thật", () => {
  const env = read(".env.example");
  assert.equal(/^(<<<<<<<|=======$|>>>>>>>)/m.test(env), false);
  assert.equal(/^(?!#)[A-Z_]*(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)=(?!your_)\S+/m.test(env), false, "giá trị bí mật không được có trong .env.example");
  assert.equal(/AIza[0-9A-Za-z_-]{30,}/.test(env), false);
});

test("không có mật khẩu/credential TURN nhúng trong mã nguồn phục vụ ra ngoài", () => {
  for (const f of ["electron/companion.html", "src/components/CompanionWebRTC.tsx", "electron/companion-server.mjs"]) {
    assert.equal(/openrelayproject/.test(read(f)), false, `${f} còn credential TURN công khai`);
  }
});

test(".gitignore chứa các mục dữ liệu cá nhân", () => {
  const gi = read(".gitignore");
  for (const entry of ["teleprompter_logs/", "robots.json", "smarthome_cameras.json", "tools/*.png", "PHONE_CAMERA/cert/", "secrets.h"]) {
    assert.ok(gi.includes(entry), `.gitignore thiếu ${entry}`);
  }
});
