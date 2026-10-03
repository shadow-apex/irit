// G-05: phím tắt toàn cục cấu hình được qua IRIS_HOTKEYS (JSON), không import electron
// để test được bằng node:test.
//
//   IRIS_HOTKEYS={"robotPip":"CommandOrControl+Alt+R","teleprompter":""}
//
// - Khoá không có trong DEFAULT_HOTKEYS bị bỏ qua (kèm cảnh báo).
// - Giá trị rỗng / null / false = TẮT phím đó (không đăng ký).
// - Hai phím trùng accelerator: phím đứng trước trong DEFAULT_HOTKEYS thắng, phím sau bị tắt (kèm cảnh báo).
// - Mặc định giữ nguyên như trước đây để không đổi thói quen người dùng. Alt+<chữ> và Super+Shift+*
//   chiếm phím của mọi ứng dụng khác / thường bị HĐH giữ → nên đổi qua IRIS_HOTKEYS nếu bị xung đột.

export const DEFAULT_HOTKEYS = Object.freeze({
  screenVision: "Super+Shift+V",
  resetToBoot: "Super+Shift+R",
  localChat: "Super+Shift+L",
  deskVision: "Super+Shift+C",
  robotPip: "Alt+R",
  companionPip: "Alt+C",
  smartHomePip: "Alt+H",
  meetingRecorder: "Alt+M",
  teleprompter: "Alt+T",
  copilot: "Alt+A",
});

const ACCELERATOR_RE = /^[A-Za-z0-9_+]+$/;
const MAX_ACCELERATOR_LENGTH = 40;

function normalizeKey(accelerator) {
  return accelerator.toLowerCase();
}

/**
 * @param {string | undefined} raw  giá trị của IRIS_HOTKEYS
 * @returns {{ hotkeys: Record<string, string | null>, warnings: string[] }}
 *   hotkeys[id] = accelerator hợp lệ, hoặc null nếu bị tắt / không hợp lệ.
 */
export function resolveHotkeys(raw) {
  const warnings = [];
  let overrides = {};

  if (raw !== undefined && String(raw).trim() !== "") {
    try {
      const parsed = JSON.parse(String(raw));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        overrides = parsed;
      } else {
        warnings.push("IRIS_HOTKEYS phải là một đối tượng JSON — bỏ qua, dùng phím mặc định.");
      }
    } catch (e) {
      warnings.push(`IRIS_HOTKEYS không phải JSON hợp lệ (${e.message}) — dùng phím mặc định.`);
    }
  }

  for (const id of Object.keys(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_HOTKEYS, id)) {
      warnings.push(`IRIS_HOTKEYS: khoá không biết "${id}" (hợp lệ: ${Object.keys(DEFAULT_HOTKEYS).join(", ")}).`);
    }
  }

  const hotkeys = {};
  const taken = new Map(); // accelerator đã chuẩn hoá -> id đang giữ
  for (const [id, fallback] of Object.entries(DEFAULT_HOTKEYS)) {
    let accelerator = fallback;
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      const v = overrides[id];
      if (v === "" || v === null || v === false) {
        hotkeys[id] = null; // tắt chủ ý
        continue;
      }
      if (typeof v === "string" && v.length <= MAX_ACCELERATOR_LENGTH && ACCELERATOR_RE.test(v.trim())) {
        accelerator = v.trim();
      } else {
        warnings.push(`IRIS_HOTKEYS: giá trị của "${id}" không hợp lệ (${JSON.stringify(v)}) — dùng mặc định ${fallback}.`);
      }
    }
    const key = normalizeKey(accelerator);
    if (taken.has(key)) {
      warnings.push(`Phím "${accelerator}" của "${id}" trùng với "${taken.get(key)}" — "${id}" bị tắt.`);
      hotkeys[id] = null;
      continue;
    }
    taken.set(key, id);
    hotkeys[id] = accelerator;
  }

  return { hotkeys, warnings };
}
