/**
 * electron/main/env-config.mjs
 *
 * .env parsing/loading, the user-editable config file (get/save/test key),
 * and small env-derived runtime flags (prompt-review mode, sleep delay, ...).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import electron from "electron";
const { app } = electron;
import { GoogleGenAI } from "@google/genai";
import { repoRoot } from "./paths.mjs";
import { liveSession, setAudioChunkSuppressed, stopLive, startLive } from "./gemini-live.mjs";
import { emitToRenderer } from "./events.mjs";
import { parseEnvContent, serializeConfigValue, mergeEnvLines, writeEnvFileSecure } from "./env-file.mjs";
import { getAllGeminiKeys, getNextGeminiKey, parseGeminiKeys, getGeminiPartitions, resetGeminiKeyPoolState, markKeyRateLimited, isRateLimitError, isKeyRateLimited } from "./gemini-keys.mjs";

export { serializeConfigValue };

export function parseEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return;
  const parsed = parseEnvContent(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value; // biến môi trường thật luôn thắng file
  }
}

export function getPromptReviewMode() {
  return envFlag("IRIS_PROMPT_REVIEW_MODE", false);
}

// How long a parked brief waits for Approve/Edit/Cancel before it auto-times
// out and is dropped (never auto-approved — see PendingReview.expire below).
export function promptReviewTimeoutMs() {
  const raw = Number(process.env.IRIS_PROMPT_REVIEW_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

export function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function sleepDelayMs() {
  const parsed = Number(process.env.IRIS_SLEEP_DELAY_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
}

export const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Aoede",
  "Leda", "Orus", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus",
];
export const GEMINI_LIVE_MODELS = ["models/gemini-3.1-flash-live-preview"];
export const ALLOWED_CONFIG_KEYS = new Set([
  "GEMINI_API_KEY",
  "GEMINI_API_KEYS",
  "GEMINI_VISION_API_KEY",
  "GEMINI_VISION_API_KEYS",
  "GEMINI_LIVE_API_KEY",
  "GEMINI_LIVE_API_KEYS",
  "GEMINI_MEETING_API_KEY",
  "GEMINI_MEETING_API_KEYS",
  "GEMINI_TELEPROMPTER_API_KEY",
  "GEMINI_TELEPROMPTER_API_KEYS",
  "ANTHROPIC_API_KEY",
  "GEMINI_LIVE_MODEL",
  "GEMINI_LIVE_VOICE",
  "IRIS_USER_NAME",
  "IRIS_LOAD_TEST_DATA",
  "IRIS_WAKE_WORD",
  // prompt-review-gate (ported from myiris): when on, submit_claude_task
  // parks the brief for the user's Approve/Edit/Cancel instead of dispatching
  // immediately — zero Claude tokens spent until approved.
  "IRIS_PROMPT_REVIEW_MODE",
  // Claude Brain toggle: when off, Gemini handles everything without Claude.
  "IRIS_CLAUDE_ENABLED",
  // Super Assistant Power Permissions (bật/tắt từ Settings):
  "IRIS_UNIVERSAL_APPS",
  "IRIS_TERMINAL_EXEC",
  "IRIS_FILESYSTEM_OPS",
  "IRIS_WINDOW_MANAGER",
  "IRIS_SYSTEM_OPS",
  "OMNIPARSER_ENABLED",
]);

// Repo .env in dev, ~/.iris/.env in a packaged build — the same location
// loadEnvFile() already reads from, so a save takes effect without restart.
export function userConfigPath() {
  return app.isPackaged ? path.join(os.homedir(), ".iris", ".env") : path.join(repoRoot, ".env");
}

export function ensureIncludes(list, value) {
  if (value && !list.includes(value)) return [value, ...list];
  return list;
}

function formatKeyPoolHint(keys) {
  if (!keys || keys.length === 0) return "";
  if (keys.length === 1) return keys[0].slice(-4);
  return `${keys.length} keys configured`;
}

// Full settings snapshot for the SetupPanel. Values come from process.env
// (populated from .env at boot and updated live on save).
export function getFullConfig() {
  const partitions = getGeminiPartitions();
  const geminiKeys = partitions.all;
  const visionKeys = partitions.vision;
  return {
    // S-10: KHÔNG trả khoá thô cho renderer (lộ qua DevTools/log/ảnh chụp). Chỉ trạng thái + 4 ký tự cuối hoặc số lượng key.
    autoStart: String(process.env.IRIS_AUTOSTART ?? "1").trim() !== "0",
    geminiApiKeySet: geminiKeys.length > 0,
    geminiApiKeyHint: formatKeyPoolHint(geminiKeys),
    geminiKeyCount: geminiKeys.length,
    geminiKeysRaw: geminiKeys.join("\n"),
    geminiPartition: {
      live: partitions.live.length,
      meeting: partitions.meeting.length,
      vision: partitions.vision.length,
      total: partitions.all.length,
    },
    geminiVisionApiKeySet: visionKeys.length > 0,
    geminiVisionApiKeyHint: formatKeyPoolHint(visionKeys),
    geminiVisionKeysRaw: visionKeys.join("\n"),
    anthropicApiKeySet: Boolean((process.env.ANTHROPIC_API_KEY || "").trim()),
    anthropicApiKeyHint: (process.env.ANTHROPIC_API_KEY || "").trim().slice(-4),
    geminiModel: process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview",
    geminiVoice: process.env.GEMINI_LIVE_VOICE || "Zephyr",
    userName: process.env.IRIS_USER_NAME || "",
    loadTestData: envFlag("IRIS_LOAD_TEST_DATA", false),
    wakeWord: envFlag("IRIS_WAKE_WORD", true),
    promptReviewMode: getPromptReviewMode(),
    claudeEnabled: envFlag("IRIS_CLAUDE_ENABLED", true),
    omniParserEnabled: envFlag("OMNIPARSER_ENABLED", true),
    universalApps: envFlag("IRIS_UNIVERSAL_APPS", true),
    terminalExec: envFlag("IRIS_TERMINAL_EXEC", true),
    filesystemOps: envFlag("IRIS_FILESYSTEM_OPS", true),
    windowManager: envFlag("IRIS_WINDOW_MANAGER", true),
    systemOps: envFlag("IRIS_SYSTEM_OPS", true),
    configured: geminiKeys.length > 0,
    voices: GEMINI_VOICES,
    models: ensureIncludes(GEMINI_LIVE_MODELS, process.env.GEMINI_LIVE_MODEL),
    configPath: userConfigPath(),
  };
}

// Merge updates into the effective .env (preserving comments/other keys) and
// apply them to process.env so they take effect on the next wake without a
// full restart. Never logs secret values (design.md D4).
export function writeUserConfig(rawUpdates) {
  const oldVoice = process.env.GEMINI_LIVE_VOICE;
  const oldModel = process.env.GEMINI_LIVE_MODEL;
  const updates = {};
  for (const [key, value] of Object.entries(rawUpdates || {})) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) continue;
    if ((key.startsWith("GEMINI_") || key === "ANTHROPIC_API_KEY") && String(value ?? "").trim() === "") continue;
    if (key.startsWith("GEMINI_") && (key.includes("KEY") || key.includes("KEYS"))) {
      const parsed = parseGeminiKeys(value);
      if (parsed.length > 0) {
        updates[key] = parsed.join(",");
      }
      continue;
    }
    updates[key] = value;
  }
  if (!Object.keys(updates).length) return getFullConfig();

  const file = userConfigPath();
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  // mergeEnvLines ném EnvValueError (xuống dòng/NUL...) TRƯỚC khi ghi bất cứ thứ gì.
  const lines = mergeEnvLines(existing, updates);
  writeEnvFileSecure(file, lines);
  for (const [key, value] of Object.entries(updates)) process.env[key] = String(value ?? "").trim();
  const keysChanged = Object.keys(updates).some(
    (k) => k.startsWith("GEMINI_") || k === "ANTHROPIC_API_KEY"
  );
  if (keysChanged) {
    resetGeminiKeyPoolState();
  }
  const voiceOrModelChanged = (updates.GEMINI_LIVE_VOICE && updates.GEMINI_LIVE_VOICE !== oldVoice) ||
                             (updates.GEMINI_LIVE_MODEL && updates.GEMINI_LIVE_MODEL !== oldModel);
  if (voiceOrModelChanged && liveSession) {
    console.log(`[Iris] Cập nhật giọng nói (${oldVoice || "mặc định"} -> ${updates.GEMINI_LIVE_VOICE}). Đang tự động kết nối lại phiên Live...`);
    stopLive().then(() => startLive()).catch((err) => {
      console.error("[Iris] Khởi động lại Live với giọng mới thất bại:", err);
    });
  }
  if (keysChanged || "OMNIPARSER_ENABLED" in updates) {
    import("./omni-server.mjs")
      .then((m) => {
        if (keysChanged) m.stopOmniServer?.();
        if (envFlag("OMNIPARSER_ENABLED", true)) {
          m.ensureOmniServer?.({ timeoutMs: 25_000 }).catch(() => {});
        } else {
          m.stopOmniServer?.();
        }
      })
      .catch(() => {});
  }
  return getFullConfig();
}

async function testSingleLiveConnection(apiKey, model, liveTimeoutMs) {
  const testAi = new GoogleGenAI({ apiKey });
  let session = null;
  let settled = false;
  try {
    await new Promise((resolve, reject) => {
      const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
      const timer = setTimeout(() => done(reject, new Error(`Kết nối Live tới ${model} quá ${Math.round(liveTimeoutMs / 1000)}s không mở được.`)), liveTimeoutMs);
      testAi.live
        .connect({
          model,
          config: { responseModalities: ["AUDIO"] },
          callbacks: {
            onopen: () => done(resolve),
            onerror: (e) => done(reject, new Error(e?.message || String(e))),
            onclose: (ev) => done(reject, new Error(`Live đóng kết nối ngay (code ${ev?.code ?? "?"}): ${ev?.reason || "không có lý do"} — kiểm tra quota/quyền model.`)),
          },
        })
        .then((s) => { session = s; if (settled) { try { s.close(); } catch { /* ignore */ } } })
        .catch((e) => done(reject, e));
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, stage: "live", error: error?.message || String(error) };
  } finally {
    try { session?.close(); } catch { /* ignore */ }
  }
}

// M-04: kiểm khoá bằng 2 bước. `models.list()` chỉ chứng minh khoá hợp lệ — KHÔNG chứng minh dùng được Live
// (hết quota free, project bị chặn, model preview không có quyền => list vẫn OK nhưng phiên Live đóng 1011/1008).
// Bước 2 mở MỘT kết nối Live thật tới model đã chọn, đợi onopen rồi đóng; trả lỗi gốc cho SetupPanel.
// Hỗ trợ kiểm tra toàn bộ danh sách key trong pool khi cấu hình nhiều key.
export async function testGeminiKey(candidateKey, { liveTimeoutMs = 10_000 } = {}) {
  const candidatePool = candidateKey ? parseGeminiKeys(candidateKey) : getAllGeminiKeys({ includeVision: false });
  if (candidatePool.length === 0) return { ok: false, error: "No API key provided." };

  const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";

  if (candidatePool.length === 1) {
    const key = candidatePool[0];
    const testAi = new GoogleGenAI({ apiKey: key });
    try {
      const pager = await testAi.models.list();
      for await (const _ of pager) break;
      try {
        await Promise.race([
          testAi.models.generateContent({
            model: "gemini-2.0-flash",
            contents: "Hi",
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("probe-timeout")), 3500)),
        ]);
      } catch (probeErr) {
        if (isRateLimitError(probeErr)) {
          markKeyRateLimited(key, 60);
        }
      }
    } catch (error) {
      return { ok: false, stage: "list", error: error?.message || String(error), validKeys: [], failedCount: 1 };
    }
    const liveRes = await testSingleLiveConnection(key, model, liveTimeoutMs);
    if (!liveRes.ok) {
      return { ...liveRes, validKeys: [], failedCount: 1 };
    }
    const isCd = isKeyRateLimited(key);
    return {
      ok: true,
      validKeys: [key],
      validCount: 1,
      totalCount: 1,
      failedCount: 0,
      message: isCd ? "Key hợp lệ nhưng hiện đang chạm hạn mức 429 (đang hồi chiêu)" : "Key hoạt động tốt (Live API sẵn sàng)",
    };
  }

  // Khi có nhiều key trong pool: kiểm tra tính hợp lệ của từng key song song
  const checks = await Promise.allSettled(
    candidatePool.map(async (key) => {
      const testAi = new GoogleGenAI({ apiKey: key });
      const pager = await testAi.models.list();
      for await (const _ of pager) break;
      try {
        await Promise.race([
          testAi.models.generateContent({
            model: "gemini-2.0-flash",
            contents: "Hi",
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("probe-timeout")), 3500)),
        ]);
      } catch (probeErr) {
        if (isRateLimitError(probeErr)) {
          markKeyRateLimited(key, 60);
        }
      }
      return key;
    })
  );

  const validKeys = [];
  const failedKeys = [];
  checks.forEach((res, idx) => {
    if (res.status === "fulfilled") {
      validKeys.push(candidatePool[idx]);
    } else {
      failedKeys.push({ key: candidatePool[idx], error: res.reason?.message || String(res.reason) });
    }
  });

  if (validKeys.length === 0) {
    return {
      ok: false,
      stage: "list",
      error: `Tất cả ${candidatePool.length} keys đều không hợp lệ. Lỗi mẫu: ${failedKeys[0]?.error}`,
      validKeys: [],
      failedCount: failedKeys.length,
    };
  }

  // Thử kết nối Live với các key khả dụng cho tới khi có ít nhất 1 key kết nối thành công
  let liveRes = null;
  for (const key of validKeys) {
    liveRes = await testSingleLiveConnection(key, model, liveTimeoutMs);
    if (liveRes.ok) break;
  }
  if (liveRes && !liveRes.ok) {
    return { ...liveRes, validKeys: [], failedCount: candidatePool.length };
  }

  const cdCount = validKeys.filter((k) => isKeyRateLimited(k)).length;
  let poolSummary = "";
  if (failedKeys.length === 0) {
    poolSummary = cdCount > 0
      ? `Toàn bộ ${validKeys.length} keys hợp lệ (${cdCount} key đang hồi chiêu 429 - xem bảng bên dưới)`
      : `Toàn bộ ${validKeys.length}/${candidatePool.length} keys hoạt động tốt (Live & Pool sẵn sàng)`;
  } else {
    poolSummary = `Đã giữ lại ${validKeys.length}/${candidatePool.length} keys hợp lệ (Đã tự động loại bỏ ${failedKeys.length} key không đủ điều kiện). ${cdCount > 0 ? `Trong đó có ${cdCount} key đang hồi chiêu 429.` : ""}`;
  }

  return {
    ok: true,
    message: poolSummary,
    validCount: validKeys.length,
    totalCount: candidatePool.length,
    failedCount: failedKeys.length,
    validKeys,
  };
}

export let previewSession = null;
export async function previewVoice(payload = {}) {
  const candidatePool = payload.key ? parseGeminiKeys(payload.key) : [];
  const apiKey = (candidatePool[0] || getNextGeminiKey({ purpose: "live" }) || "").trim();
  if (!apiKey) return { ok: false, error: "Chưa có API key Gemini. Vui lòng lưu ít nhất 1 key trước khi nghe thử." };
  const voiceName = payload.voice || process.env.GEMINI_LIVE_VOICE || "Zephyr";
  const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";

  try {
    setAudioChunkSuppressed(true);
  } catch {}

  let previewTimeout = null;
  try {
    if (previewSession) {
      try { previewSession.close(); } catch { /* ignore */ }
      previewSession = null;
    }
    const previewAi = new GoogleGenAI({ apiKey });

    await new Promise((resolve, reject) => {
      previewTimeout = setTimeout(() => {
        try { previewSession?.close(); } catch {}
        previewSession = null;
        resolve();
      }, 12000);

      previewAi.live
        .connect({
          model,
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            systemInstruction: {
              parts: [{ text: "You are a friendly voice preview for the Iris assistant. Say the requested phrase clearly and naturally." }],
            },
          },
          callbacks: {
            onmessage(message) {
              const content = message.serverContent;
              if (!content) return;
              for (const part of content.modelTurn?.parts || []) {
                const inlineData = part.inlineData;
                if (inlineData?.data && (inlineData.mimeType || "").startsWith("audio/")) {
                  emitToRenderer("live:audio", { data: inlineData.data, mimeType: inlineData.mimeType });
                }
              }
              if (content.turnComplete) {
                clearTimeout(previewTimeout);
                try { previewSession?.close(); } catch { /* ignore */ }
                previewSession = null;
                resolve();
              }
            },
            onerror(err) {
              clearTimeout(previewTimeout);
              previewSession = null;
              reject(err);
            },
            onclose() {
              clearTimeout(previewTimeout);
              previewSession = null;
              resolve();
            },
          },
        })
        .then((session) => {
          previewSession = session;
          session.sendRealtimeInput({
            text: `Say exactly: Hi, I'm Iris. This is the ${voiceName} voice.`,
          });
        })
        .catch((connErr) => {
          clearTimeout(previewTimeout);
          previewSession = null;
          reject(connErr);
        });
    });

    return { ok: true };
  } catch (error) {
    if (previewTimeout) clearTimeout(previewTimeout);
    previewSession = null;
    let errMsg = error?.message || String(error);
    if (/429|RESOURCE_EXHAUSTED/i.test(errMsg)) {
      errMsg = "Key Gemini đang bị giới hạn (429). Thử lại sau ít phút hoặc đổi sang key khác.";
    }
    return { ok: false, error: errMsg };
  } finally {
    try {
      setAudioChunkSuppressed(false);
    } catch {}
  }
}
