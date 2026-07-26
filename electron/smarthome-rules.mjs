// electron/smarthome-rules.mjs
//
// A small automation-rule engine on top of Iris's existing smart-home
// control path (trigger_smart_home / robots.json / setupsmarthome bridge).
// It doesn't talk to devices itself — it stores rules like "at 22:00, turn
// off the living room light" or "every 30 minutes, turn on the fan", and on
// a timer checks which ones are due and calls back into an injected
// `executeAction(action)` function (main.mjs wires this to the existing
// triggerSmartHome()) to actually flip the device. Same dependency
// injection shape as electron/run-queue.mjs's startRun — this module never
// needs to know about Electron, robots.json, or HTTP.
//
// Rules are created by Iris from natural language: Gemini/Claude turns a
// sentence like "khi qua 10 giờ tối thì tắt đèn phòng khách" into the
// structured {trigger, condition, action} shape below and calls
// createRule(); this module only deals with the structured form.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const RULES_DIR = path.join(os.homedir(), ".iris");
const RULES_FILE = path.join(RULES_DIR, "smarthome-rules.json");

function ensureDir() {
  if (!fs.existsSync(RULES_DIR)) fs.mkdirSync(RULES_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(RULES_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or partially-written file: fail safe to "no rules" rather
    // than crash the evaluator loop.
    return [];
  }
}

function save(rules) {
  ensureDir();
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), "utf8");
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `rule_${Date.now().toString(36)}_${idCounter}`;
}

const VALID_TRIGGER_TYPES = new Set(["time", "interval"]);
const VALID_DAYS = new Set(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);

function assertValidTrigger(trigger) {
  if (!trigger || !VALID_TRIGGER_TYPES.has(trigger.type)) {
    throw new Error("trigger.type phải là 'time' (kèm 'at': \"HH:MM\") hoặc 'interval' (kèm 'every_minutes').");
  }
  if (trigger.type === "time" && !/^\d{1,2}:\d{2}$/.test(String(trigger.at || ""))) {
    throw new Error("trigger.at phải theo định dạng \"HH:MM\", ví dụ \"22:00\".");
  }
  if (trigger.type === "interval" && !(Number(trigger.every_minutes) > 0)) {
    throw new Error("trigger.every_minutes phải là số phút lớn hơn 0.");
  }
}

/**
 * rule shape:
 * {
 *   id, label, enabled,
 *   trigger: { type: "time", at: "22:00" } | { type: "interval", every_minutes: 30 },
 *   condition: { type: "none" } | { type: "day_of_week", days: ["mon", ...] },
 *   action: { device, action },       // same shape trigger_smart_home already takes
 *   last_fired_key,                    // dedupe key so a repeated tick doesn't refire
 *   created_at,
 * }
 */
export function createRule({ label, trigger, condition = { type: "none" }, action } = {}) {
  assertValidTrigger(trigger);
  if (!action || !action.device || !action.action) {
    throw new Error("action cần có 'device' và 'action' (giống trigger_smart_home).");
  }
  if (condition?.type === "day_of_week") {
    const days = Array.isArray(condition.days) ? condition.days : [];
    if (!days.length || days.some((d) => !VALID_DAYS.has(d))) {
      throw new Error("condition.days phải là danh sách trong: sun, mon, tue, wed, thu, fri, sat.");
    }
  }
  const rules = load();
  const rule = {
    id: nextId(),
    label: label || `${action.device}: ${action.action}`,
    enabled: true,
    trigger,
    condition,
    action,
    last_fired_key: null,
    created_at: Date.now(),
  };
  rules.push(rule);
  save(rules);
  return rule;
}

export function listRules() {
  return load();
}

export function deleteRule(id) {
  const rules = load();
  const next = rules.filter((r) => r.id !== id);
  const removed = next.length !== rules.length;
  if (removed) save(next);
  return removed;
}

export function setRuleEnabled(id, enabled) {
  const rules = load();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return null;
  rule.enabled = Boolean(enabled);
  save(rules);
  return rule;
}

function matchesCondition(condition, now) {
  if (!condition || condition.type === "none") return true;
  if (condition.type === "day_of_week") {
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return Array.isArray(condition.days) && condition.days.includes(days[now.getDay()]);
  }
  return true;
}

function dueKeyForTrigger(trigger, now) {
  if (trigger.type === "time") {
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const current = `${hh}:${mm}`;
    if (current !== trigger.at) return null;
    // Includes the date so a once-a-day time trigger fires exactly once per
    // day at that minute, even though the evaluator loop ticks every ~20s.
    return `${now.toDateString()}@${current}`;
  }
  if (trigger.type === "interval") {
    const everyMs = Math.max(1, Number(trigger.every_minutes) || 1) * 60000;
    const bucket = Math.floor(now.getTime() / everyMs);
    return `interval:${bucket}`;
  }
  return null;
}

/**
 * Call on a timer (main.mjs ticks this every ~20s). `executeAction(action)`
 * is injected — main.mjs passes its existing triggerSmartHome so this
 * module never duplicates robots.json/HTTP logic. `onFired` is an optional
 * hook for logging/voice announcements.
 */
export async function evaluateRules(executeAction, { onFired } = {}) {
  if (typeof executeAction !== "function") throw new Error("evaluateRules requires 'executeAction'.");
  const rules = load();
  const now = new Date();
  let changed = false;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const dueKey = dueKeyForTrigger(rule.trigger, now);
    if (!dueKey || dueKey === rule.last_fired_key) continue;
    if (!matchesCondition(rule.condition, now)) continue;
    rule.last_fired_key = dueKey;
    changed = true;
    try {
      const result = await executeAction(rule.action);
      onFired?.({ rule, result, status: "success" });
    } catch (error) {
      onFired?.({ rule, error: error?.message || String(error), status: "error" });
    }
  }
  if (changed) save(rules);
}
