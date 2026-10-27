import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_CONFIG_KEYS, getFullConfig } from "../../../electron/main/env-config.mjs";
import { annotateWithOmniParser } from "../../../electron/computer-session.mjs";

test("IRIS_OMNI_AUTO_ANNOTATE nằm trong ALLOWED_CONFIG_KEYS và getFullConfig()", () => {
  assert.ok(ALLOWED_CONFIG_KEYS.has("IRIS_OMNI_AUTO_ANNOTATE"), "ALLOWED_CONFIG_KEYS phải chứa IRIS_OMNI_AUTO_ANNOTATE");
  
  delete process.env.IRIS_OMNI_AUTO_ANNOTATE;
  assert.equal(getFullConfig().omniAutoAnnotate, false, "Mặc định omniAutoAnnotate phải là false");

  process.env.IRIS_OMNI_AUTO_ANNOTATE = "true";
  assert.equal(getFullConfig().omniAutoAnnotate, true, "omniAutoAnnotate phải là true khi IRIS_OMNI_AUTO_ANNOTATE='true'");

  delete process.env.IRIS_OMNI_AUTO_ANNOTATE;
});

test("annotateWithOmniParser: xuất khẩu đúng hàm và xử lý graceful fallback khi offline", async () => {
  assert.equal(typeof annotateWithOmniParser, "function", "annotateWithOmniParser phải được export");

  // Giả lập ảnh 1x1 jpeg base64
  const dummyB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  
  // Khi server offline / timeout: hàm phải trả về fallback an toàn không throw lỗi
  const prevUrl = process.env.OMNIPARSER_API_URL;
  const prevTimeout = process.env.OMNIPARSER_TIMEOUT_MS;
  process.env.OMNIPARSER_API_URL = "http://omni-offline.invalid:8000/parse";
  process.env.OMNIPARSER_TIMEOUT_MS = "500";
  try {
    const res = await annotateWithOmniParser(dummyB64, 1920, 1080);
    assert.ok(res, "Kết quả trả về phải tồn tại");
    assert.ok(typeof res.base64 === "string", "base64 phải là chuỗi");
    assert.equal(typeof res.annotated, "boolean", "annotated phải là boolean");
    assert.equal(typeof res.elementsText, "string", "elementsText phải là chuỗi");
  } finally {
    if (prevUrl === undefined) delete process.env.OMNIPARSER_API_URL;
    else process.env.OMNIPARSER_API_URL = prevUrl;
    if (prevTimeout === undefined) delete process.env.OMNIPARSER_TIMEOUT_MS;
    else process.env.OMNIPARSER_TIMEOUT_MS = prevTimeout;
  }
});

test("SetupPanel có render nút gạt IRIS_OMNI_AUTO_ANNOTATE", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = fs.readFileSync(path.resolve("src/components/SetupPanel.tsx"), "utf8");
  assert.ok(file.includes("IRIS_OMNI_AUTO_ANNOTATE"), "SetupPanel.tsx phải quản lý biến IRIS_OMNI_AUTO_ANNOTATE");
  assert.ok(file.includes("omniAutoAnnotate"), "SetupPanel.tsx phải có key dịch omniAutoAnnotate");
});
