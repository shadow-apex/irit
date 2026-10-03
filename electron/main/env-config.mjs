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
import { liveSession } from "./gemini-live.mjs";
import { emitToRenderer } from "./events.mjs";
import { parseEnvContent, serializeConfigValue, mergeEnvLines, writeEnvFileSecure } from "./env-file.mjs";

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

// Full settings snapshot for the SetupPanel. Values come from process.env
// (populated from .env at boot and updated live on save).
export function getFullConfig() {
  return {
    // S-10: KHÔNG trả khoá thô cho renderer (lộ qua DevTools/log/ảnh chụp). Chỉ trạng thái + 4 ký tự cuối.
    autoStart: String(process.env.IRIS_AUTOSTART ?? "1").trim() !== "0",
    geminiApiKeySet: Boolean((process.env.GEMINI_API_KEY || "").trim()),
    geminiApiKeyHint: (process.env.GEMINI_API_KEY || "").trim().slice(-4),
    geminiModel: process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview",
    geminiVoice: process.env.GEMINI_LIVE_VOICE || "Zephyr",
    userName: process.env.IRIS_USER_NAME || "",
    loadTestData: envFlag("IRIS_LOAD_TEST_DATA", false),
    wakeWord: envFlag("IRIS_WAKE_WORD", true),
    promptReviewMode: getPromptReviewMode(),
    claudeEnabled: envFlag("IRIS_CLAUDE_ENABLED", true),
    configured: Boolean((process.env.GEMINI_API_KEY || "").trim()),
    voices: GEMINI_VOICES,
    models: ensureIncludes(GEMINI_LIVE_MODELS, process.env.GEMINI_LIVE_MODEL),
    configPath: userConfigPath(),
  };
}

// Merge updates into the effective .env (preserving comments/other keys) and
// apply them to process.env so they take effect on the next wake without a
// full restart. Never logs secret values (design.md D4).
export function writeUserConfig(rawUpdates) {
  const updates = {};
  for (const [key, value] of Object.entries(rawUpdates || {})) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) continue;
    // S-10: SetupPanel không còn nhận khoá thô; ô trống = "giữ khoá hiện tại", không xoá.
    if (key === "GEMINI_API_KEY" && String(value ?? "").trim() === "") continue;
    updates[key] = value;
  }
  if (!Object.keys(updates).length) return getFullConfig();

  const file = userConfigPath();
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  // mergeEnvLines ném EnvValueError (xuống dòng/NUL...) TRƯỚC khi ghi bất cứ thứ gì.
  const lines = mergeEnvLines(existing, updates);
  writeEnvFileSecure(file, lines);
  for (const [key, value] of Object.entries(updates)) process.env[key] = String(value ?? "").trim();
  return getFullConfig();
}

// M-04: kiểm khoá bằng 2 bước. `models.list()` chỉ chứng minh khoá hợp lệ — KHÔNG chứng minh dùng được Live
// (hết quota free, project bị chặn, model preview không có quyền => list vẫn OK nhưng phiên Live đóng 1011/1008).
// Bước 2 mở MỘT kết nối Live thật tới model đã chọn, đợi onopen rồi đóng; trả lỗi gốc cho SetupPanel.
export async function testGeminiKey(candidateKey, { liveTimeoutMs = 10_000 } = {}) {
  const key = (candidateKey || process.env.GEMINI_API_KEY || "").trim();
  if (!key) return { ok: false, error: "No API key provided." };
  const testAi = new GoogleGenAI({ apiKey: key });
  try {
    const pager = await testAi.models.list();
    for await (const _ of pager) break;
  } catch (error) {
    return { ok: false, stage: "list", error: error?.message || String(error) };
  }

  const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
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

export let previewSession = null;
export async function previewVoice(payload = {}) {
  if (liveSession) return { ok: false, error: "Sleep Iris before previewing a voice." };
  const apiKey = (payload.key || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return { ok: false, error: "Save your Gemini key first." };
  const voiceName = payload.voice || process.env.GEMINI_LIVE_VOICE || "Zephyr";
  const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
  try {
    if (previewSession) {
      try { previewSession.close(); } catch { /* ignore */ }
      previewSession = null;
    }
    const previewAi = new GoogleGenAI({ apiKey });
    previewSession = await previewAi.live.connect({
      model,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        systemInstruction: {
          parts: [{ text: "You are a short voice sample. Say exactly the line you are asked to say, nothing more." }],
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
            try { previewSession?.close(); } catch { /* ignore */ }
            previewSession = null;
          }
        },
        onerror() { previewSession = null; },
        onclose() { previewSession = null; },
      },
    });
    // Send AFTER connect resolves: onopen can fire before the session variable is
    // assigned, so triggering inside onopen would no-op (silent preview).
    previewSession.sendRealtimeInput({
      text: `Say exactly: Hi, I'm Iris. This is the ${voiceName} voice.`,
    });
    return { ok: true };
  } catch (error) {
    previewSession = null;
    return { ok: false, error: error?.message || String(error) };
  }
}
