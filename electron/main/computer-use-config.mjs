/**
 * electron/main/computer-use-config.mjs
 *
 * M-01: chọn model + phiên bản tool + beta header cho Claude Computer Use theo CẤU HÌNH, không hardcode.
 * Nguồn (kiểm ngày 03/10/2026): trang "Tool reference" của Anthropic —
 *   computer_20251124 ↔ beta computer-use-2025-11-24  (Opus 4.5+, Sonnet 4.6+)
 *   computer_20250124 ↔ beta computer-use-2025-01-24  (Sonnet 4.5/Haiku 4.5/Opus 4.1/Sonnet 3.7)
 *   computer_20241022 ↔ beta computer-use-2024-10-22  (Sonnet 3.5 — đã deprecated/retired)
 * Bản mới hơn (vd computer_toolset_20260801, không cần beta) CHƯA xác nhận được từ tài liệu: đặt
 * IRIS_COMPUTER_USE_TOOL / IRIS_COMPUTER_USE_BETA ("none" = không gửi beta) khi Anthropic công bố.
 * Module thuần.
 */
export const DEFAULT_COMPUTER_USE_MODEL = "claude-sonnet-4-6";

const TOOL_TABLE = [
  // [regex theo model id, tool type, beta]
  [/claude-3-5-sonnet/, "computer_20241022", "computer-use-2024-10-22"],
  [/claude-(3-7-sonnet|sonnet-4-0|sonnet-4-5|haiku-4-5|opus-4-0|opus-4-1)/, "computer_20250124", "computer-use-2025-01-24"],
];
const LATEST = { tool: "computer_20251124", beta: "computer-use-2025-11-24" };

export function resolveComputerUseConfig(env = process.env) {
  const model = String(env.IRIS_COMPUTER_USE_MODEL || "").trim() || DEFAULT_COMPUTER_USE_MODEL;
  let tool = LATEST.tool;
  let beta = LATEST.beta;
  for (const [re, t, b] of TOOL_TABLE) {
    if (re.test(model)) { tool = t; beta = b; break; }
  }
  const toolOverride = String(env.IRIS_COMPUTER_USE_TOOL || "").trim();
  if (toolOverride) tool = toolOverride;
  const betaOverride = String(env.IRIS_COMPUTER_USE_BETA || "").trim();
  if (betaOverride) beta = betaOverride.toLowerCase() === "none" ? null : betaOverride;
  return { model, tool, beta, maxTokens: 4096 };
}

/** Thông báo lỗi dễ hiểu thay cho "API Error" chung chung. */
export function explainComputerUseError(err, cfg) {
  const status = err?.status ?? err?.statusCode;
  const msg = String(err?.message || err || "");
  if (status === 404 || /not_found|model.*(not|invalid)|invalid model/i.test(msg)) {
    return `Model "${cfg.model}" không khả dụng hoặc không có quyền dùng Computer Use. Đặt IRIS_COMPUTER_USE_MODEL trong .env thành một model còn hoạt động (mặc định ${DEFAULT_COMPUTER_USE_MODEL}). Chi tiết: ${msg}`;
  }
  if (status === 401 || /authentication|invalid x-api-key|api key/i.test(msg)) {
    return `ANTHROPIC_API_KEY không hợp lệ hoặc đã hết hạn. Chi tiết: ${msg}`;
  }
  if (status === 400 && /beta|tool|computer/i.test(msg)) {
    return `Phiên bản tool/beta không khớp model "${cfg.model}" (đang dùng ${cfg.tool}, beta ${cfg.beta ?? "none"}). Chỉnh IRIS_COMPUTER_USE_TOOL / IRIS_COMPUTER_USE_BETA theo trang computer-use của Anthropic. Chi tiết: ${msg}`;
  }
  if (status === 429) return `Anthropic API đang giới hạn tốc độ/quota (429). Thử lại sau. Chi tiết: ${msg}`;
  return msg || "Lỗi không xác định khi gọi Anthropic API.";
}
