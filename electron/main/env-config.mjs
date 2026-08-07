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

export function parseEnvFile(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key]) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
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
    geminiApiKey: process.env.GEMINI_API_KEY || "",
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

export function serializeConfigValue(value) {
  const str = String(value ?? "").trim();
  return /[\s"#]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
}

// Merge updates into the effective .env (preserving comments/other keys) and
// apply them to process.env so they take effect on the next wake without a
// full restart. Never logs secret values (design.md D4).
export function writeUserConfig(rawUpdates) {
  const updates = {};
  for (const [key, value] of Object.entries(rawUpdates || {})) {
    if (ALLOWED_CONFIG_KEYS.has(key)) updates[key] = value;
  }
  if (!Object.keys(updates).length) return getFullConfig();

  const file = userConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const remaining = new Set(Object.keys(updates));
  const out = [];
  for (const line of existing) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? trimmed : trimmed.slice(0, eq).trim();
    if (remaining.has(key)) {
      out.push(`${key}=${serializeConfigValue(updates[key])}`);
      remaining.delete(key);
    } else {
      out.push(line);
    }
  }
  for (const key of remaining) out.push(`${key}=${serializeConfigValue(updates[key])}`);

  fs.writeFileSync(file, `${out.join("\n").replace(/\n+$/, "")}\n`, "utf8");
  for (const [key, value] of Object.entries(updates)) process.env[key] = String(value ?? "").trim();
  return getFullConfig();
}

// Validate a Gemini key by forcing one authenticated round-trip (ListModels).
export async function testGeminiKey(candidateKey) {
  const key = (candidateKey || process.env.GEMINI_API_KEY || "").trim();
  if (!key) return { ok: false, error: "No API key provided." };
  try {
    const testAi = new GoogleGenAI({ apiKey: key });
    const pager = await testAi.models.list();
    for await (const _ of pager) break;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
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
