/**
 * electron/main/reminders.mjs
 *
 * TL-09: nhắc việc do tiến trình Electron quản lý (thay cho tiến trình Python `sleep` tách rời mất khi
 * reboot nhưng vẫn nằm trong `list` — "nhắc ma"). Lưu JSON trong userData (ghi atomic), nạp lại khi khởi
 * động, đặt `setTimeout`. Module thuần: `notify`, `now`, `setTimer` được tiêm vào để test.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const MAX_MINUTES = 7 * 24 * 60; // setTimeout tối đa ≈ 24,8 ngày; giới hạn 7 ngày cho an toàn
export const OVERDUE_GRACE_MS = 60 * 60 * 1000; // quá hạn < 1 giờ khi khởi động ⇒ vẫn nhắc; quá nữa ⇒ bỏ

export function createReminderService({
  file,
  notify,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {},
} = {}) {
  /** @type {Map<string,{id:string,title:string,message:string,target_ts:number}>} */
  const items = new Map();
  /** @type {Map<string,any>} */
  const timers = new Map();

  function persist() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...items.values()], null, 1), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) {
      log(`[reminders] không ghi được ${file}: ${e.message}`);
    }
  }

  async function fire(id) {
    const r = items.get(id);
    timers.delete(id);
    if (!r) return;
    try {
      await notify({ title: r.title, message: r.message });
    } catch (e) {
      // KHÔNG nuốt lỗi: báo ra log; giữ lại mục để người dùng thấy nó chưa hiện được.
      log(`[reminders] gửi nhắc '${r.title}' thất bại: ${e.message}`);
      items.delete(id);
      persist();
      return;
    }
    items.delete(id);
    persist();
  }

  function arm(r) {
    const delay = Math.max(0, r.target_ts - now());
    timers.set(r.id, setTimer(() => fire(r.id), delay));
  }

  return {
    /** Nạp lại từ đĩa khi khởi động. Trả về { restored, fired, dropped }. */
    load() {
      let restored = 0, fired = 0, dropped = 0;
      let data = [];
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        data = [];
      }
      if (!Array.isArray(data)) data = [];
      for (const r of data) {
        if (!r || typeof r.id !== "string" || !Number.isFinite(r.target_ts)) { dropped++; continue; }
        const late = now() - r.target_ts;
        if (late > OVERDUE_GRACE_MS) { dropped++; continue; }
        items.set(r.id, { id: r.id, title: String(r.title || ""), message: String(r.message || ""), target_ts: r.target_ts });
        if (late >= 0) fired++; else restored++;
        arm(items.get(r.id));
      }
      persist();
      return { restored, fired, dropped };
    },

    schedule({ minutes, title, message }) {
      const m = Number(minutes);
      if (!Number.isFinite(m) || m <= 0) return { success: false, error: "Số phút phải lớn hơn 0." };
      if (m > MAX_MINUTES) return { success: false, error: `Tối đa ${MAX_MINUTES} phút (7 ngày).` };
      if (!title || !message) return { success: false, error: "Cần cả 'title' và 'message'." };
      const id = crypto.randomBytes(4).toString("hex");
      const r = { id, title: String(title).slice(0, 120), message: String(message).slice(0, 500), target_ts: now() + m * 60_000 };
      items.set(id, r);
      arm(r);
      persist();
      return { success: true, id, fires_in_minutes: m, message: `Đã đặt nhắc '${r.title}' sau ${m} phút.` };
    },

    list() {
      const t = now();
      return {
        success: true,
        reminders: [...items.values()]
          .sort((a, b) => a.target_ts - b.target_ts)
          .map((r) => ({ id: r.id, title: r.title, message: r.message, fires_in_seconds: Math.max(0, Math.round((r.target_ts - t) / 1000)) })),
      };
    },

    cancel(id) {
      if (!items.has(id)) return { success: false, error: `Không tìm thấy nhắc việc id=${id}.` };
      clearTimer(timers.get(id));
      timers.delete(id);
      items.delete(id);
      persist();
      return { success: true, message: `Đã huỷ nhắc việc ${id}.` };
    },

    /** Dừng mọi timer (khi thoát app) mà KHÔNG xoá dữ liệu đã lưu. */
    dispose() {
      for (const t of timers.values()) clearTimer(t);
      timers.clear();
    },
  };
}
