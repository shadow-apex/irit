/**
 * electron/main/crash-log.mjs
 *
 * T-01: ghi lỗi toàn cục (uncaughtException / unhandledRejection) vào `<userData>/logs/main.log`
 * có xoay vòng. Module thuần node.
 */
import fs from "node:fs";
import path from "node:path";

export const MAX_LOG_BYTES = 1_000_000;
const KEEP = 3;

export function createFileLogger(dir, { maxBytes = MAX_LOG_BYTES, keep = KEEP, name = "main.log" } = {}) {
  const file = path.join(dir, name);
  function rotateIfNeeded() {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
        for (let i = keep - 1; i >= 1; i--) {
          const from = `${file}.${i}`;
          if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i + 1}`);
        }
        fs.renameSync(file, `${file}.1`);
        const last = `${file}.${keep + 1}`;
        if (fs.existsSync(last)) fs.rmSync(last, { force: true });
      }
    } catch {
      /* xoay vòng thất bại không được làm hỏng việc ghi log */
    }
  }
  function write(level, message) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      rotateIfNeeded();
      fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`, "utf8");
    } catch {
      /* hết cách: console */
      console.error(`[${level}] ${message}`);
    }
  }
  return { file, write };
}

export function describeError(e) {
  if (e instanceof Error) return e.stack || `${e.name}: ${e.message}`;
  try {
    return typeof e === "string" ? e : JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Gắn handler toàn cục. `isReady()` quyết định có thoát hay không khi lỗi xảy ra lúc khởi động. */
export function installGlobalErrorHandlers({ logger, isReady, onError = () => {}, exit = (c) => process.exit(c), proc = process }) {
  proc.on("uncaughtException", (e) => {
    const msg = describeError(e);
    logger.write("fatal", `uncaughtException: ${msg}`);
    onError("uncaughtException", msg);
    // Lỗi nghiêm trọng khi KHỞI ĐỘNG không được nuốt: app ở trạng thái nửa vời. Sau khi sẵn sàng
    // thì giữ app chạy (đã ghi log + báo UI) — một lỗi ở tính năng phụ không nên giết cả app.
    if (!isReady()) exit(1);
  });
  proc.on("unhandledRejection", (e) => {
    const msg = describeError(e);
    logger.write("error", `unhandledRejection: ${msg}`);
    onError("unhandledRejection", msg);
  });
}
