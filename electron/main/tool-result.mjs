/**
 * electron/main/tool-result.mjs
 *
 * TL-03: MỘT schema duy nhất cho kết quả tool trả về Gemini: `{ ...fields, status: "success" | "error" }`.
 *
 * Trước đây `{ status: "success", ...JSON.parse(stdout) }` để khoá `status`/`success` của script đè lên hoặc
 * cùng tồn tại, và script lỗi (`{"success":false}` thoát mã 0, hoặc `{"error":...}` không có `success`)
 * vẫn bị gắn "success" ⇒ Gemini nói "xong" dù thất bại. Module thuần (không import electron).
 */

/**
 * @param {any} parsed  object JSON do script in ra (hoặc null)
 * @param {{exitCode?:number, fallbackError?:string}} [opts]
 */
export function normalizeToolResult(parsed, { exitCode = 0, fallbackError = "" } = {}) {
  const p = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const failed =
    exitCode !== 0 ||
    p.success === false ||
    p.status === "error" ||
    (p.error != null && p.error !== "" && p.success !== true);
  const { status: _s, success: _ok, ...rest } = p;
  if (failed && !rest.error) rest.error = fallbackError || `Công cụ thất bại (mã thoát ${exitCode}).`;
  // `status` đặt SAU CÙNG để không trường nào của script ghi đè được.
  return { ...rest, status: failed ? "error" : "success" };
}

/** Lấy object JSON ở dòng cuối cùng parse được (script có thể in thêm cảnh báo trước đó). */
export function parseToolOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      const v = JSON.parse(lines[i]);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {
      /* thử dòng trước */
    }
  }
  try {
    const v = JSON.parse(text); // JSON nhiều dòng
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Chuyển kết quả `runPythonTool` thành phản hồi cho Gemini.
 * @param {{ok:boolean,code?:number,stdout?:string,stderr?:string,error?:string,timedOut?:boolean}} run
 */
export function buildToolResponse(run, failMsg = "Công cụ thất bại.") {
  if (run.timedOut) return { status: "error", error: run.error || "Công cụ chạy quá thời gian cho phép." };
  const parsed = parseToolOutput(run.stdout);
  if (parsed) {
    return normalizeToolResult(parsed, {
      exitCode: run.ok ? 0 : run.code ?? 1,
      fallbackError: run.stderr || run.error || failMsg,
    });
  }
  // Không có JSON hợp lệ: KHÔNG bao giờ coi là thành công.
  return {
    status: "error",
    error: run.error || (run.stderr ? run.stderr : run.ok ? "Công cụ không trả về JSON hợp lệ." : failMsg),
    ...(run.stdout ? { raw_output: String(run.stdout).slice(0, 2000) } : {}),
  };
}

/** Tham số tự do dạng `--tên=giá trị` (giá trị bắt đầu bằng '-' không còn làm argparse hiểu nhầm — TL-14). */
export function optArg(name, value) {
  return `--${name}=${String(value)}`;
}

/** Số thực → int làm tròn (TL-14); trả về null nếu không phải số hữu hạn. */
export function toIntArg(v) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}
