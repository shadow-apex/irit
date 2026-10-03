/**
 * electron/main/dangerous-tools.mjs
 *
 * S-11: công cụ nguy hiểm cần XÁC NHẬN HAI BƯỚC. Trước đây Gemini gọi được shutdown/restart/sleep,
 * kill tiến trình, tắt Wi-Fi/camera ngay tức thì chỉ bằng một lệnh thoại nghe nhầm.
 *
 * Lần gọi đầu trả { status:"needs_confirmation", confirm_token, message } (không thực thi). Chỉ khi có
 * lần gọi thứ hai mang đúng `confirm_token` (gắn với đúng tool + đối số, còn hạn 30 s, dùng một lần)
 * thì mới chạy. Module thuần (không import electron).
 */
import crypto from "node:crypto";

/** tool -> (args) => true nếu lời gọi đó nguy hiểm. */
export const DANGEROUS = {
  power_manager: (a) => ["shutdown", "restart", "sleep"].includes(String(a.action || "").toLowerCase()),
  system_control: (a) => [a.wifi, a.bluetooth, a.camera].some((v) => String(v || "").toLowerCase() === "off"),
  process_manager: (a) => String(a.action || "").toLowerCase() === "kill",
  close_app: () => true,
};

export const CONFIRM_TTL_MS = 30_000;

export function isDangerousCall(name, args = {}) {
  const fn = DANGEROUS[name];
  return typeof fn === "function" && fn(args || {}) === true;
}

function fingerprint(name, args) {
  const { confirm_token: _drop, ...rest } = args || {};
  const sorted = Object.keys(rest).sort().reduce((o, k) => ((o[k] = rest[k]), o), {});
  return `${name}:${JSON.stringify(sorted)}`;
}

function describe(name, args) {
  const { confirm_token: _drop, ...rest } = args || {};
  const detail = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(", ");
  return `${name}${detail ? ` (${detail})` : ""}`;
}

export function createConfirmGate({ now = Date.now, ttlMs = CONFIRM_TTL_MS, newToken = () => crypto.randomBytes(6).toString("hex"), onPending = () => {} } = {}) {
  /** @type {Map<string,{fp:string,expires:number}>} */
  const pending = new Map();

  function sweep() {
    const t = now();
    for (const [tok, p] of pending) if (p.expires <= t) pending.delete(tok);
  }

  return {
    /**
     * @returns {null | object} null = được phép thực thi; object = kết quả trả thẳng cho Gemini.
     */
    check(name, args = {}) {
      if (!isDangerousCall(name, args)) return null;
      sweep();
      const fp = fingerprint(name, args);
      const supplied = typeof args.confirm_token === "string" ? args.confirm_token : "";
      if (supplied) {
        const p = pending.get(supplied);
        if (p && p.fp === fp && p.expires > now()) {
          pending.delete(supplied); // dùng một lần
          return null;
        }
        return {
          status: "error",
          error: "confirm_token không hợp lệ, đã hết hạn (30 giây) hoặc không khớp với thao tác này. Hãy xin xác nhận lại từ người dùng.",
        };
      }
      const token = newToken();
      pending.set(token, { fp, expires: now() + ttlMs });
      const what = describe(name, args);
      onPending({ tool: name, args, token, what });
      return {
        status: "needs_confirmation",
        confirm_token: token,
        expires_in_seconds: Math.round(ttlMs / 1000),
        message:
          `Thao tác nguy hiểm: ${what}. CHƯA thực hiện. Hãy đọc to thao tác này cho người dùng và hỏi họ có chắc không. ` +
          `Chỉ khi người dùng nói rõ đồng ý, mới gọi lại ĐÚNG công cụ này với cùng đối số kèm confirm_token="${token}" ` +
          `(hiệu lực ${Math.round(ttlMs / 1000)} giây, dùng một lần). Nếu họ từ chối hoặc không trả lời, KHÔNG gọi lại.`,
      };
    },
    pendingCount: () => (sweep(), pending.size),
  };
}

/** Thêm `confirm_token` + chú thích quy trình vào khai báo các tool nguy hiểm (cho Gemini). */
export function annotateDangerousDeclarations(declarations) {
  const NOTE =
    " ⚠ Thao tác nguy hiểm: lần gọi đầu chỉ trả needs_confirmation + confirm_token (chưa thực thi). " +
    "Hỏi người dùng xác nhận bằng giọng nói; chỉ khi họ đồng ý mới gọi lại với confirm_token.";
  for (const d of declarations) {
    if (!(d.name in DANGEROUS)) continue;
    if (!d.description.includes("needs_confirmation")) d.description += NOTE;
    const schema = d.parameters || d.input_schema;
    if (schema) {
      schema.properties = schema.properties || {};
      schema.properties.confirm_token = {
        type: "string",
        description: "Chỉ điền ở lần gọi thứ hai, sau khi người dùng đã xác nhận (lấy từ kết quả needs_confirmation).",
      };
    }
  }
  return declarations;
}
