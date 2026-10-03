import test from "node:test";
import assert from "node:assert/strict";
import { resolveComputerUseConfig, explainComputerUseError, DEFAULT_COMPUTER_USE_MODEL } from "../../electron/main/computer-use-config.mjs";

test("mặc định: model hiện hành + tool/beta mới nhất, max_tokens >= 4096", () => {
  const c = resolveComputerUseConfig({});
  assert.equal(c.model, DEFAULT_COMPUTER_USE_MODEL);
  assert.notEqual(c.model, "claude-3-5-sonnet-20241022");
  assert.equal(c.tool, "computer_20251124");
  assert.equal(c.beta, "computer-use-2025-11-24");
  assert.ok(c.maxTokens >= 4096);
});
test("tool/beta theo model", () => {
  assert.deepEqual(resolveComputerUseConfig({ IRIS_COMPUTER_USE_MODEL: "claude-sonnet-4-5" }).tool, "computer_20250124");
  assert.equal(resolveComputerUseConfig({ IRIS_COMPUTER_USE_MODEL: "claude-haiku-4-5-20251001" }).beta, "computer-use-2025-01-24");
  assert.equal(resolveComputerUseConfig({ IRIS_COMPUTER_USE_MODEL: "claude-opus-4-6" }).tool, "computer_20251124");
});
test("ghi đè bằng env; beta 'none' => không gửi beta", () => {
  const c = resolveComputerUseConfig({ IRIS_COMPUTER_USE_TOOL: "computer_toolset_20260801", IRIS_COMPUTER_USE_BETA: "none" });
  assert.equal(c.tool, "computer_toolset_20260801");
  assert.equal(c.beta, null);
});
test("lỗi 404/401/400/429 được giải thích rõ", () => {
  const cfg = resolveComputerUseConfig({});
  assert.match(explainComputerUseError({ status: 404, message: "not_found_error: model" }, cfg), /IRIS_COMPUTER_USE_MODEL/);
  assert.match(explainComputerUseError({ status: 401, message: "invalid x-api-key" }, cfg), /ANTHROPIC_API_KEY/);
  assert.match(explainComputerUseError({ status: 400, message: "invalid beta flag" }, cfg), /IRIS_COMPUTER_USE_TOOL/);
  assert.match(explainComputerUseError({ status: 429, message: "rate" }, cfg), /429/);
});
