/**
 * electron/main/gemini-keys.mjs
 *
 * Gemini API Key Pool manager with Round-Robin rotation and automatic
 * failover (cooldown) on HTTP 429 / RESOURCE_EXHAUSTED / quota errors.
 */
import { GoogleGenAI } from "@google/genai";

// Map<apiKey, cooldownUntilTimestampMs>
const keyCooldowns = new Map();

// Cache GoogleGenAI instances per API key to avoid redundant allocations
const clientCache = new Map();

// Independent Round-Robin index for standby pool and default pool
let standbyRoundRobinIndex = 0;
let defaultRoundRobinIndex = 0;

/**
 * Chuẩn hóa tên domain tác vụ:
 * - "live": Gemini Live (trò chuyện thoại realtime qua WebSocket)
 * - "meeting": Alt+M (Ghi âm tóm tắt cuộc họp)
 * - "teleprompter": Alt+T (Live Teleprompter dịch & nhắc bài)
 * - "vision": Phân tích hình ảnh màn hình, camera bàn, camera điện thoại
 */
export function normalizePurpose(purpose, preferVision = false) {
  if (preferVision) return "vision";
  const p = String(purpose || "").toLowerCase().trim();
  if (p === "live" || p === "voice" || p === "chat") return "live";
  if (p === "meeting" || p === "recorder" || p === "record" || p === "recording" || p === "meeting_recording") {
    return "meeting";
  }
  if (p === "teleprompter" || p === "copilot" || p === "translate" || p === "qna" || p === "interview") {
    return "teleprompter";
  }
  if (p === "vision" || p === "screen" || p === "camera" || p === "ocr") {
    return "vision";
  }
  return "default";
}

/**
 * Tách chuỗi rawString thành mảng các Gemini API key hợp lệ,
 * loại bỏ khoảng trắng, dấu nháy bao ngoài và các key trùng lặp.
 * Hỗ trợ phân tách bằng dấu phẩy (,), chấm phẩy (;), xuống dòng (\r, \n) hoặc khoảng trắng.
 *
 * @param {string | string[] | null | undefined} rawString
 * @returns {string[]}
 */
export function parseGeminiKeys(rawString) {
  if (rawString == null) return [];
  const combined = Array.isArray(rawString) ? rawString.join(",") : String(rawString);
  if (!combined.trim()) return [];

  const parts = combined
    .split(/[,;\r\n\s]+/)
    .map((part) => {
      const clean = part.trim().replace(/^["']+|["']+$/g, "").trim();
      const match = clean.match(/\b(AIza[0-9A-Za-z-_]{35})\b/);
      return match ? match[1] : clean;
    })
    .filter((k) => k && !k.startsWith("//") && !k.startsWith("#"));

  return [...new Set(parts)];
}

/**
 * Phân chia kho key theo kiến trúc: 3 Key Độc Lập Chuyên Dụng + Kho Dự Phòng Dùng Chung
 * - 3 key độc lập ban đầu (Mỗi nhóm giữ riêng 1 key cố định):
 *     1) Live Chat: Key 1
 *     2) Alt+M / Alt+T: Key 2
 *     3) Vision: Key 3
 * - Kho dự phòng dùng chung (Shared Standby Pool):
 *     7 keys còn lại (Key 4 -> Key 10).
 *
 * Nguyên tắc hoạt động:
 * 1. Bình thường: Mỗi nhóm chỉ dùng ĐÚNG key riêng của mình -> 100% độc lập, không tranh chấp quota.
 * 2. Khi 1 key bị hết (chạm 429 / quota): Tác vụ đó lập tức lấy key từ Kho dự phòng 7 keys.
 * 3. Sau 60s cooldown: Tác vụ tự động quay về sử dụng lại key độc lập chính của mình.
 *
 * @returns {{
 *   primary: { live: string, meeting: string, teleprompter: string, vision: string },
 *   standby: string[],
 *   live: string[],
 *   meeting: string[],
 *   teleprompter: string[],
 *   vision: string[],
 *   all: string[]
 * }}
 */
export function getGeminiPartitions() {
  const liveExplicit = parseGeminiKeys(
    process.env.GEMINI_LIVE_API_KEY || process.env.GEMINI_LIVE_API_KEYS || ""
  );
  const meetingExplicit = parseGeminiKeys(
    process.env.GEMINI_MEETING_API_KEY || process.env.GEMINI_MEETING_API_KEYS || ""
  );
  const teleprompterExplicit = parseGeminiKeys(
    process.env.GEMINI_TELEPROMPTER_API_KEY || process.env.GEMINI_TELEPROMPTER_API_KEYS || ""
  );
  const visionExplicit = parseGeminiKeys(
    process.env.GEMINI_VISION_API_KEY || process.env.GEMINI_VISION_API_KEYS || ""
  );

  const generalKeys = parseGeminiKeys(
    [process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY].filter(Boolean).join(",")
  );

  const allKeys = [
    ...new Set([...generalKeys, ...liveExplicit, ...meetingExplicit, ...teleprompterExplicit, ...visionExplicit]),
  ];

  if (allKeys.length === 0) {
    return {
      primary: { live: "", meeting: "", teleprompter: "", vision: "" },
      standby: [],
      live: [],
      meeting: [],
      teleprompter: [],
      vision: [],
      all: [],
    };
  }

  // 1) Xác định 4 key độc lập chuyên dụng (Primary keys)
  let livePrimary = liveExplicit[0] || null;
  let meetingPrimary = meetingExplicit[0] || null;
  let teleprompterPrimary = teleprompterExplicit[0] || null;
  let visionPrimary = visionExplicit[0] || null;

  const assignedSet = new Set([livePrimary, meetingPrimary, teleprompterPrimary, visionPrimary].filter(Boolean));
  const availableGeneral = generalKeys.filter((k) => !assignedSet.has(k));

  let cursor = 0;
  if (!livePrimary && cursor < availableGeneral.length) {
    livePrimary = availableGeneral[cursor++];
  }
  if (!meetingPrimary && cursor < availableGeneral.length) {
    meetingPrimary = availableGeneral[cursor++];
  }
  if (!teleprompterPrimary && cursor < availableGeneral.length) {
    teleprompterPrimary = availableGeneral[cursor++];
  }
  if (!visionPrimary && cursor < availableGeneral.length) {
    visionPrimary = availableGeneral[cursor++];
  }

  // Fallback nếu tổng số key trong toàn hệ thống ít hơn 4
  if (!livePrimary) livePrimary = allKeys[0] || "";
  if (!meetingPrimary) meetingPrimary = allKeys[1] || allKeys[0] || "";
  if (!teleprompterPrimary) teleprompterPrimary = allKeys[2] || allKeys[1] || allKeys[0] || "";
  if (!visionPrimary) visionPrimary = allKeys[3] || allKeys[2] || allKeys[1] || allKeys[0] || "";

  // 2) Kho dự phòng dùng chung (Shared Standby Pool):
  // Gồm tất cả các key còn lại sau khi đã phân bổ 4 key độc lập
  const primaryKeysSet = new Set([livePrimary, meetingPrimary, teleprompterPrimary, visionPrimary].filter(Boolean));
  const standby = allKeys.filter((k) => !primaryKeysSet.has(k));

  return {
    primary: {
      live: livePrimary,
      meeting: meetingPrimary,
      teleprompter: teleprompterPrimary,
      vision: visionPrimary,
    },
    standby,
    // Danh sách key ứng với từng nhóm bao gồm: Key độc lập + Kho dự phòng dùng chung
    live: [livePrimary, ...standby].filter(Boolean),
    meeting: [meetingPrimary, ...standby].filter(Boolean),
    teleprompter: [teleprompterPrimary, ...standby].filter(Boolean),
    vision: [visionPrimary, ...standby].filter(Boolean),
    all: allKeys,
  };
}

/**
 * Trả về danh sách key dành riêng cho một purpose cụ thể.
 *
 * @param {string} [purpose]
 * @param {{ preferVision?: boolean }} [options]
 * @returns {string[]}
 */
export function getKeysForPurpose(purpose, { preferVision = false } = {}) {
  const group = normalizePurpose(purpose, preferVision);
  const partitions = getGeminiPartitions();
  if (group === "live") return partitions.live;
  if (group === "meeting") return partitions.meeting;
  if (group === "teleprompter") return partitions.teleprompter;
  if (group === "vision") return partitions.vision;
  return partitions.all;
}

/**
 * Đọc toàn bộ danh sách Gemini API key từ biến môi trường:
 * process.env.GEMINI_API_KEYS, process.env.GEMINI_API_KEY và process.env.GEMINI_VISION_API_KEY (nếu có).
 *
 * @param {{ preferVision?: boolean, includeVision?: boolean, purpose?: string }} [options]
 * @returns {string[]}
 */
export function getAllGeminiKeys({ preferVision = false, includeVision = true, purpose } = {}) {
  if (purpose) {
    const groupKeys = getKeysForPurpose(purpose, { preferVision });
    if (groupKeys.length > 0) return groupKeys;
  }

  const partitions = getGeminiPartitions();
  const explicitVisionKeys = parseGeminiKeys(
    process.env.GEMINI_VISION_API_KEY || process.env.GEMINI_VISION_API_KEYS || ""
  );

  if (preferVision) {
    return [
      ...new Set([...explicitVisionKeys, ...partitions.all]),
    ];
  }
  if (!includeVision) {
    const visionSet = new Set(explicitVisionKeys);
    return partitions.all.filter((k) => !visionSet.has(k));
  }
  return partitions.all;
}

/**
 * Kiểm tra xem một key hiện có đang trong thời gian nghỉ (cooldown) do lỗi 429 hay không.
 *
 * @param {string} apiKey
 * @param {number} [now]
 * @returns {boolean}
 */
export function isKeyRateLimited(apiKey, now = Date.now()) {
  if (!apiKey) return false;
  const until = keyCooldowns.get(apiKey);
  if (!until) return false;
  if (now >= until) {
    keyCooldowns.delete(apiKey);
    return false;
  }
  return true;
}

/**
 * Bảng thống kê số lượt gọi và số lần chạm 429 theo thời gian thực (phục vụ Live Monitor)
 */
export const keyCallStats = new Map();

function recordKeyCall(key) {
  if (!key) return;
  const current = keyCallStats.get(key) || { calls: 0, rateLimits: 0, lastUsed: 0 };
  current.calls += 1;
  current.lastUsed = Date.now();
  keyCallStats.set(key, current);
}

function recordKeyRateLimit(key) {
  if (!key) return;
  const current = keyCallStats.get(key) || { calls: 0, rateLimits: 0, lastUsed: 0 };
  current.rateLimits += 1;
  keyCallStats.set(key, current);
}

/**
 * Đưa key bị lỗi 429 / hết quota vào danh sách chờ (cooldown).
 *
 * @param {string} apiKey
 * @param {number} [cooldownSeconds=60]
 */
let onKeyPoolChangeCallback = null;
export function setKeyPoolChangeListener(fn) {
  onKeyPoolChangeCallback = fn;
}

export function markKeyRateLimited(apiKey, cooldownSeconds = 60) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) return;
  recordKeyRateLimit(cleanKey);
  const seconds = Number.isFinite(cooldownSeconds) ? cooldownSeconds : 60;
  if (seconds <= 0) {
    keyCooldowns.delete(cleanKey);
  } else {
    keyCooldowns.set(cleanKey, Date.now() + Math.round(seconds * 1000));
  }
  if (typeof onKeyPoolChangeCallback === "function") {
    try {
      onKeyPoolChangeCallback();
    } catch {}
  }
}

/**
 * Đặt lại trạng thái bộ đếm Round-Robin, cache client và danh sách cooldown (hữu ích cho unit test & khi đổi cấu hình).
 */
export function resetGeminiKeyPoolState() {
  keyCooldowns.clear();
  keyCallStats.clear();
  clientCache.clear();
  standbyRoundRobinIndex = 0;
  defaultRoundRobinIndex = 0;
}

/**
 * Lấy báo cáo trạng thái trực tiếp của 10 key trong Key Pool (Live Monitor)
 * Bao gồm: danh xưng, vai trò, trạng thái sẵn sàng hay cooldown, số giây còn lại và số lượt gọi.
 */
export function getKeyPoolLiveStatus() {
  const partitions = getGeminiPartitions();
  const now = Date.now();

  const mapKeyInfo = (key, role, index, isPrimary = false) => {
    if (!key) return null;
    const until = keyCooldowns.get(key) ?? 0;
    const inCooldown = until > now;
    const cooldownRemainingMs = inCooldown ? until - now : 0;
    const remainingSec = Math.ceil(cooldownRemainingMs / 1000);
    const stats = keyCallStats.get(key) || { calls: 0, rateLimits: 0, lastUsed: 0 };
    const masked = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "••••";
    return {
      index,
      hint: masked,
      keyHint: masked,
      role,
      isPrimary,
      ready: !inCooldown,
      status: inCooldown ? "cooldown" : "ready",
      remainingCooldownSec: remainingSec,
      cooldownRemainingSeconds: remainingSec,
      totalCalls: stats.calls,
      calls: stats.calls,
      totalRateLimits: stats.rateLimits,
      rateLimits: stats.rateLimits,
      lastUsed: stats.lastUsed,
    };
  };

  const keys = [];
  if (partitions.primary.live) {
    keys.push(mapKeyInfo(partitions.primary.live, "Live Voice", 1, true));
  }
  if (partitions.primary.meeting) {
    keys.push(mapKeyInfo(partitions.primary.meeting, "Alt+M Cuộc Họp", 2, true));
  }
  if (partitions.primary.teleprompter) {
    keys.push(mapKeyInfo(partitions.primary.teleprompter, "Alt+T Teleprompter", 3, true));
  }
  if (partitions.primary.vision) {
    keys.push(mapKeyInfo(partitions.primary.vision, "Vision / Screen", 4, true));
  }
  partitions.standby.forEach((k, idx) => {
    keys.push(mapKeyInfo(k, `Standby Dự Phòng ${idx + 1}`, idx + 5, false));
  });

  const readyCount = partitions.all.filter((k) => !isKeyRateLimited(k, now)).length;
  const cooldownCount = partitions.all.filter((k) => isKeyRateLimited(k, now)).length;

  return {
    configured: partitions.all.length > 0,
    totalKeys: partitions.all.length,
    readyCount,
    activeKeys: readyCount,
    cooldownCount,
    cooldownKeys: cooldownCount,
    keys: keys.filter(Boolean),
  };
}

/**
 * Trả về key khả dụng tiếp theo theo thuật toán:
 * 1) Ưu tiên số 1: Sử dụng Key Độc Lập Chuyên Dụng của nhóm (Primary Key):
 *    - Live Chat -> Key 1
 *    - Alt+M / Alt+T -> Key 2
 *    - Vision -> Key 3
 *    -> Trong điều kiện bình thường: 100% độc lập, không tranh chấp quota.
 * 2) Khi Key Độc Lập chạm giới hạn (429 / cooldown):
 *    - Tự động lấy key từ Kho Dự Phòng 7 Keys dùng chung (Standby Pool), xoay vòng Round-Robin.
 * 3) Khi Key Độc Lập hết thời gian cooldown (sau 60s):
 *    - Tự động quay về sử dụng lại Key Độc Lập của mình.
 *
 * @param {{ purpose?: string, preferVision?: boolean, includeVision?: boolean }} [options]
 * @returns {string | null}
 */
export function getNextGeminiKey(options = {}) {
  const partitions = getGeminiPartitions();
  const allKeys = partitions.all;
  if (allKeys.length === 0) return null;

  const now = Date.now();
  const group = normalizePurpose(options.purpose, options.preferVision);

  let selectedKey = null;

  // 1) Nếu có xác định nhóm (live, meeting, vision): Kiểm tra key độc lập chuyên dụng trước
  if (group !== "default" && partitions.primary[group]) {
    const primaryKey = partitions.primary[group];
    if (!isKeyRateLimited(primaryKey, now)) {
      selectedKey = primaryKey;
    } else {
      // 2) Key chuyên dụng đang bị cooldown 429: Lấy từ Kho Dự Phòng Dùng Chung (7 keys standby)
      const standbyPool = partitions.standby;
      const totalStandby = standbyPool.length;
      if (totalStandby > 0) {
        for (let i = 0; i < totalStandby; i++) {
          const idx = (standbyRoundRobinIndex + i) % totalStandby;
          const candidate = standbyPool[idx];
          if (!isKeyRateLimited(candidate, now)) {
            standbyRoundRobinIndex = (idx + 1) % totalStandby;
            selectedKey = candidate;
            break;
          }
        }
      }

      // 3) Nếu cả kho dự phòng cũng cạn: Mượn tạm key chính của các nhóm khác nếu còn rảnh
      if (!selectedKey) {
        for (const otherKey of Object.values(partitions.primary)) {
          if (otherKey && otherKey !== primaryKey && !isKeyRateLimited(otherKey, now)) {
            selectedKey = otherKey;
            break;
          }
        }
      }
    }
  } else {
    // Trường hợp gọi chung (default): Xoay vòng trong toàn bộ allKeys
    const total = allKeys.length;
    for (let offset = 0; offset < total; offset++) {
      const idx = (defaultRoundRobinIndex + offset) % total;
      const candidate = allKeys[idx];
      if (!isKeyRateLimited(candidate, now)) {
        defaultRoundRobinIndex = (idx + 1) % total;
        selectedKey = candidate;
        break;
      }
    }
  }

  // 4) Fallback cuối cùng: Tất cả mọi key trong hệ thống đều đang cooldown
  // Chọn key có thời điểm hết hạn cooldown sớm nhất.
  if (!selectedKey) {
    let bestKey = allKeys[0];
    let earliestUntil = Infinity;
    for (const key of allKeys) {
      const until = keyCooldowns.get(key) ?? 0;
      if (until < earliestUntil) {
        earliestUntil = until;
        bestKey = key;
      }
    }
    selectedKey = bestKey;
  }

  if (selectedKey) {
    recordKeyCall(selectedKey);
  }
  return selectedKey;
}

/**
 * Nhận diện lỗi HTTP 429 / Rate Limit / Quota Exceeded / RESOURCE_EXHAUSTED từ Gemini SDK.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRateLimitError(err) {
  if (!err) return false;
  const status = err?.status ?? err?.code ?? err?.httpStatus ?? err?.error?.code;
  if (
    status === 429 ||
    status === "429" ||
    status === "RESOURCE_EXHAUSTED" ||
    status === 503 ||
    status === "503" ||
    status === "UNAVAILABLE"
  ) {
    return true;
  }
  if (
    err?.error?.status === "RESOURCE_EXHAUSTED" ||
    err?.error?.status === "UNAVAILABLE"
  ) {
    return true;
  }
  const msg = String(err?.message || err?.error?.message || err || "");
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|quota|rate[\s_-]*limit|too many requests|high demand|spikes in demand|temporarily unavailable|overloaded/i.test(msg);
}

/**
 * Trả về instance GoogleGenAI tương ứng với key được chỉ định hoặc key khả dụng tiếp theo trong pool của purpose đó.
 *
 * @param {string | { apiKey?: string, purpose?: string, preferVision?: boolean, includeVision?: boolean }} [optionsOrKey]
 * @returns {GoogleGenAI | null}
 */
export function getGenAiClient(optionsOrKey) {
  let apiKey = null;
  let purpose = undefined;
  let preferVision = false;
  let includeVision = true;

  if (typeof optionsOrKey === "string") {
    apiKey = optionsOrKey.trim();
  } else if (optionsOrKey && typeof optionsOrKey === "object") {
    preferVision = Boolean(optionsOrKey.preferVision);
    purpose = optionsOrKey.purpose;
    if (optionsOrKey.includeVision !== undefined) {
      includeVision = Boolean(optionsOrKey.includeVision);
    }
    if (typeof optionsOrKey.apiKey === "string") {
      apiKey = optionsOrKey.apiKey.trim();
    }
  }

  if (!apiKey) {
    apiKey = getNextGeminiKey({ purpose, preferVision, includeVision });
  }
  if (!apiKey) return null;

  let client = clientCache.get(apiKey);
  if (!client) {
    // Giới hạn kích thước cache để chống rò rỉ bộ nhớ
    if (clientCache.size >= 50) {
      const oldestKey = clientCache.keys().next().value;
      if (oldestKey) clientCache.delete(oldestKey);
    }
    client = new GoogleGenAI({ apiKey });
    clientCache.set(apiKey, client);
  }
  return client;
}

/**
 * Hàm bọc thực thi tác vụ Gemini `taskFn(apiKey, attempt)` với cơ chế Auto-Failover theo nhóm tác vụ (purpose):
 * - Live: Thử lại với key kế tiếp trong nhóm Live
 * - Meeting / Teleprompter: Thử lại với key kế tiếp trong nhóm Meeting
 * - Vision: Thử lại với key kế tiếp trong nhóm Vision
 *
 * Nếu `taskFn` ném lỗi 429 / RESOURCE_EXHAUSTED / hết quota, tự động đánh dấu cooldown
 * cho key đó và lập tức thử lại với key khả dụng kế tiếp.
 *
 * @template T
 * @param {(apiKey: string, attempt: number) => Promise<T> | T} taskFn
 * @param {{
 *   purpose?: string,
 *   maxRetries?: number,
 *   cooldownSeconds?: number,
 *   preferVision?: boolean,
 *   includeVision?: boolean,
 *   onFailover?: (info: { failedKey: string, attempt: number, maxRetries: number, error: unknown }) => void
 * }} [options]
 * @returns {Promise<T>}
 */
export async function withGeminiFailover(
  taskFn,
  { purpose, maxRetries, cooldownSeconds = 60, preferVision = false, includeVision = true, onFailover } = {}
) {
  const poolKeys = getAllGeminiKeys({ purpose, preferVision, includeVision });
  const allSystemKeys = getAllGeminiKeys({ includeVision: true });
  if (poolKeys.length === 0 && allSystemKeys.length === 0) {
    throw new Error("Thiếu GEMINI_API_KEY (chưa cấu hình API key Gemini).");
  }

  const retries = Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : Math.max(3, allSystemKeys.length);
  const triedKeys = new Set();
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const apiKey = getNextGeminiKey({ purpose, preferVision, includeVision });
    if (!apiKey) {
      throw lastError || new Error("Không có Gemini API key khả dụng.");
    }
    triedKeys.add(apiKey);

    try {
      return await taskFn(apiKey, attempt);
    } catch (err) {
      lastError = err;
      if (isRateLimitError(err)) {
        markKeyRateLimited(apiKey, cooldownSeconds);
        // Chỉ retry tiếp nếu còn lượt thử VÀ trong pool còn key chưa bị rate-limited ở lượt này
        // (chống lặp vô nghĩa khi người dùng chỉ có 1 key duy nhất hoặc toàn bộ kho key đã kiệt)
        if (attempt < retries && triedKeys.size < allSystemKeys.length) {
          const masked = apiKey.length > 8 ? `...${apiKey.slice(-4)}` : apiKey;
          console.warn(`[Gemini Failover] Key (${masked}) chạm hạn mức (429/quota). Tự động đổi sang key tiếp theo (lần thử ${attempt + 1}/${retries})...`);
          if (typeof onFailover === "function") {
            try {
              onFailover({ failedKey: apiKey, attempt: attempt + 1, maxRetries: retries, error: err });
            } catch {
              // ignore callback error
            }
          }
          continue;
        }
      }
      throw err;
    }
  }

  throw lastError;
}
