// Hợp đồng cho thư mục tools/: biên dịch, cấm mẫu nguy hiểm, schema thống nhất, tài liệu ↔ file thật.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildClaudeTools } from "../../electron/main/claude-tools-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const toolsDir = path.join(root, "tools");
const py = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".py"));
const read = (f) => fs.readFileSync(path.join(toolsDir, f), "utf8");
const PYTHON = process.platform === "win32" ? "python" : "python3";

test("py_compile sạch cho mọi tools/*.py", () => {
  const r = spawnSync(PYTHON, ["-m", "py_compile", ...py.map((f) => path.join(toolsDir, f))], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("không có os.system( / shell=True / pip install / PowerShell nội suy trong tools/", () => {
  for (const f of py) {
    const src = read(f).replace(/"""[\s\S]*?"""/g, ""); // bỏ docstring (được phép nhắc tới các mẫu cấm)
    const code = src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert.doesNotMatch(code, /os\.system\(/, `${f}: os.system`);
    assert.doesNotMatch(code, /shell\s*=\s*True/, `${f}: shell=True`);
    // chỉ bắt việc THỰC THI pip (không bắt câu hướng dẫn "pip install -r ..." trong thông báo lỗi)
    assert.doesNotMatch(code, /sys\.executable[^\n]*pip|["']pip["']\s*,\s*["']install|pip\.main|ensurepip/, `${f}: tự pip install`);
    assert.doesNotMatch(code, /-Command["']?\s*,\s*f["']/, `${f}: PowerShell -Command với f-string`);
  }
});

test("mọi script dùng _common (hoặc nằm trong danh sách ngoại lệ)", () => {
  const EXEMPT = new Set(["_common.py", "_winutil.py", "_procutil.py"]);
  for (const f of py) {
    if (EXEMPT.has(f)) continue;
    assert.match(read(f), /^import _common/m, `${f} phải import _common`);
    assert.match(read(f), /ensure_utf8\(\)/, `${f} phải gọi ensure_utf8()`);
  }
});

test("không có BOM, không còn file chết", () => {
  for (const f of py) assert.notEqual(fs.readFileSync(path.join(toolsDir, f)).subarray(0, 3).toString("hex"), "efbbbf", `${f} có BOM`);
  for (const dead of ["minimize.ps1", "minimize_app.bat", "write_note.bat", "ai_vision.py", "quick_reminder.py"]) {
    assert.equal(fs.existsSync(path.join(toolsDir, dead)), false, `${dead} phải bị xoá`);
  }
});

test("mô tả tool trong catalog chỉ nhắc script TỒN TẠI", () => {
  const decls = buildClaudeTools()[0].functionDeclarations;
  for (const d of decls) {
    for (const m of d.description.matchAll(/tools\/([A-Za-z0-9_]+\.py)/g)) {
      assert.ok(py.includes(m[1]), `catalog '${d.name}' nhắc ${m[1]} không tồn tại`);
    }
  }
});

test("mọi tool Gemini gọi script đều có script tương ứng (wrapper ↔ file)", () => {
  const src = fs.readFileSync(path.join(root, "electron/main/local-tools.mjs"), "utf8");
  for (const m of src.matchAll(/"([a-z_]+\.py)"/g)) {
    if (m[1] === "x.py") continue;
    assert.ok(py.includes(m[1]), `local-tools.mjs gọi ${m[1]} không tồn tại`);
  }
});

test("tài liệu/skill/requirements không nhắc script không tồn tại", () => {
  const files = [
    "tools/requirements.txt", "tools/README.md", ".agents/skills/sys-monitor/SKILL.md", ".agents/skills/ai-vision/SKILL.md",
    ".agents/skills/myiris/references/project_tree.md", ".agents/skills/window-magic/SKILL.md", ".agents/skills/clipboard/SKILL.md",
    ".agents/skills/notify/SKILL.md", ".agents/skills/sys-control/SKILL.md",
  ];
  for (const rel of files) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, "utf8").matchAll(/\b(?:tools\/)?([a-z_]+\.py)\b/g)) {
      const name = m[1];
      if (["api_server.py", "meeting_recorder.py", "live_transcriber.py", "setup.py"].includes(name)) continue;
      if (name.startsWith("test_") || name === "_path.py") continue;
      if (!rel.includes("project_tree") && !py.includes(name)) assert.fail(`${rel} nhắc ${name} không tồn tại`);
    }
  }
});

test("catalog có get_system_stats, không trùng tên, tool nguy hiểm đã gắn xác nhận", () => {
  const decls = buildClaudeTools()[0].functionDeclarations;
  const names = decls.map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("get_system_stats"));
  assert.match(decls.find((d) => d.name === "process_manager").description, /confirm_token/);
});

test("không đọc IRIS_PYTHON_BIN / OMNIPARSER_* ở cấp module (P-03)", () => {
  for (const rel of ["electron/main/local-tools.mjs", "electron/main/paths.mjs", "electron/computer-session.mjs"]) {
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    lines.forEach((l, i) => {
      if (/^(export\s+)?(const|let|var)\s/.test(l) && /process\.env\.(IRIS_PYTHON_BIN|IRIS_TOOLS_DIR|OMNIPARSER_)/.test(l) && !/=>/.test(l) && !/^\s*\/\//.test(l)) {
        // dòng khai báo cấp module đọc env trực tiếp (không phải hàm lười)
        const next = lines[i + 1] || "";
        assert.ok(/=>/.test(l) || /=>/.test(next), `${rel}:${i + 1} đọc env ở cấp module: ${l.trim()}`);
      }
    });
  }
});
