// P-03: giá trị đặt SAU khi module đã được import vẫn có hiệu lực (đọc lười), và .env nạp bởi main.mjs đến kịp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pythonBin, toolsDir } from "../../electron/main/paths.mjs";

test("pythonBin()/toolsDir() phản ánh biến môi trường đặt SAU khi import", () => {
  const prev = { p: process.env.IRIS_PYTHON_BIN, t: process.env.IRIS_TOOLS_DIR };
  try {
    process.env.IRIS_PYTHON_BIN = "C:\\Python312\\python.exe";
    process.env.IRIS_TOOLS_DIR = "D:\\iris-tools";
    assert.equal(pythonBin(), "C:\\Python312\\python.exe");
    assert.equal(toolsDir(), "D:\\iris-tools");
    process.env.IRIS_PYTHON_BIN = "py";
    assert.equal(pythonBin(), "py");
  } finally {
    for (const [k, v] of [["IRIS_PYTHON_BIN", prev.p], ["IRIS_TOOLS_DIR", prev.t]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});
