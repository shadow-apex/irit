/**
 * electron/main/env-file.mjs
 *
 * S-10: đọc/ghi `.env` AN TOÀN. Module thuần (node:*), test được bằng `node --test`.
 *
 * Trước đây `serializeConfigValue` không xử lý xuống dòng => giá trị "x\nIRIS_CLAUDE_BIN=evil" chèn
 * thêm một dòng KEY=VALUE tuỳ ý (danh sách khoá cho phép chỉ lọc tên khoá, không lọc giá trị) — ví dụ
 * đổi binary `claude` sang file độc hại. Nay:
 *   - giá trị chứa \r \n \0 bị TỪ CHỐI;
 *   - giá trị cần trích dẫn được escape `\` rồi `"`, và parser unescape đối xứng (round-trip);
 *   - ghi atomic, quyền 0600.
 */
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../atomic-file.mjs";

export class EnvValueError extends Error {}

export function serializeConfigValue(value) {
  const raw = String(value ?? "");
  // Kiểm tra trên chuỗi THÔ (trước trim): "\nFOO=1" cũng bị từ chối, không "được làm sạch" lặng lẽ.
  if (/[\r\n\0]/.test(raw)) {
    throw new EnvValueError("Giá trị cấu hình không được chứa xuống dòng hoặc ký tự NUL.");
  }
  const str = raw.trim();
  if (str === "") return "";
  // Trích dẫn khi có khoảng trắng, dấu nháy, #, =, hoặc \ (để round-trip chính xác)
  if (/[\s"'#=\\]/.test(str)) {
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return str;
}

/** Giải mã một giá trị đã đọc từ dòng `.env` (đối xứng với serializeConfigValue). */
export function unquoteEnvValue(raw) {
  const value = String(raw).trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    // chỉ \\ và \" là escape; backslash khác giữ nguyên (tương thích file cũ)
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

/** @returns {Record<string,string>} */
export function parseEnvContent(contents) {
  const out = {};
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    out[key] = unquoteEnvValue(line.slice(eq + 1));
  }
  return out;
}

/**
 * Gộp `updates` vào danh sách dòng hiện có (giữ nguyên comment/khoá khác).
 * Ném EnvValueError TRƯỚC khi sửa bất cứ thứ gì nếu có giá trị không hợp lệ.
 */
export function mergeEnvLines(existingLines, updates) {
  const serialized = {};
  for (const [k, v] of Object.entries(updates)) serialized[k] = serializeConfigValue(v); // validate hết trước
  const remaining = new Set(Object.keys(serialized));
  const out = [];
  for (const line of existingLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? trimmed : trimmed.slice(0, eq).trim();
    if (remaining.has(key)) {
      out.push(`${key}=${serialized[key]}`);
      remaining.delete(key);
    } else {
      out.push(line);
    }
  }
  for (const key of remaining) out.push(`${key}=${serialized[key]}`);
  return out;
}

/** Ghi atomic với quyền 0600 (chmod bỏ qua lỗi trên Windows). */
export function writeEnvFileSecure(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  writeFileAtomicSync(file, data, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows: không hỗ trợ chmod kiểu POSIX */
  }
}
