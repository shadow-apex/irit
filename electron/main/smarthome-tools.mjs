/**
 * electron/main/smarthome-tools.mjs
 *
 * Claude/Gemini-facing tools for managing smart-home automation rules
 * (create/list/delete/enable), plus the background evaluator that checks
 * rule triggers on an interval.
 */
import * as smarthomeRules from "../smarthome-rules.mjs";
import { submitAction } from "../action-lane.mjs";
import { emitEvent } from "./events.mjs";
import { triggerSmartHome } from "./robot-actions.mjs";
import { laneEventLogger } from "./computer-use-tools.mjs";

// Smart-home automation rules (electron/smarthome-rules.mjs) are evaluated
// on a plain timer, independent of Gemini/Claude turns entirely — this is
// what lets "turn off the lights at 10pm" keep working even mid-conversation
// or while Claude Code is busy on something else.
let smarthomeRuleTimer = null;

export function createSmarthomeRuleTool(args = {}) {
  try {
    const rule = smarthomeRules.createRule(args);
    return { status: "success", rule, message: `Đã tạo automation: ${rule.label}` };
  } catch (error) {
    return { status: "error", error: error.message };
  }
}

export function listSmarthomeRulesTool() {
  return { status: "success", rules: smarthomeRules.listRules() };
}

export function deleteSmarthomeRuleTool({ rule_id } = {}) {
  if (!rule_id) return { status: "error", error: "Thiếu rule_id." };
  const removed = smarthomeRules.deleteRule(rule_id);
  return removed
    ? { status: "success", message: `Đã xoá automation ${rule_id}.` }
    : { status: "error", error: `Không tìm thấy automation: ${rule_id}` };
}

export function setSmarthomeRuleEnabledTool({ rule_id, enabled } = {}) {
  if (!rule_id) return { status: "error", error: "Thiếu rule_id." };
  const rule = smarthomeRules.setRuleEnabled(rule_id, Boolean(enabled));
  return rule
    ? { status: "success", rule }
    : { status: "error", error: `Không tìm thấy automation: ${rule_id}` };
}

// Ticks every 20s, independent of any Gemini/Claude turn. Each due rule
// fires through the "smarthome" lane (reusing the existing triggerSmartHome
// device path) so many rules — or a rule firing while the user is mid
// conversation — never block each other or anything else.
export function startSmarthomeRuleEvaluator() {
  if (smarthomeRuleTimer) return;
  smarthomeRuleTimer = setInterval(() => {
    smarthomeRules
      .evaluateRules(
        (action) =>
          new Promise((resolve, reject) => {
            submitAction({
              lane: "smarthome",
              label: `Automation: ${action.device} → ${action.action}`,
              fn: async () => {
                try {
                  const result = await triggerSmartHome(action);
                  if (result.status === "error") reject(new Error(result.error));
                  else resolve(result);
                  return result;
                } catch (err) {
                  // Make sure the outer Promise settles even if
                  // triggerSmartHome throws instead of returning
                  // {status:"error"} — otherwise this would hang forever.
                  reject(err);
                  throw err;
                }
              },
              onEvent: laneEventLogger("Smart-home automation"),
            });
          }),
        {
          onFired: ({ rule, status, error }) => {
            emitEvent({
              type: "log",
              level: status === "success" ? "info" : "error",
              message:
                status === "success"
                  ? `[Automation] Đã chạy: ${rule.label}`
                  : `[Automation] Lỗi khi chạy "${rule.label}": ${error}`,
            });
          },
        }
      )
      .catch((err) => {
        emitEvent({ type: "log", level: "error", message: `[Automation] Lỗi vòng lặp đánh giá rule: ${err.message}` });
      });
  }, 20000);
}

// External writer: main.mjs's before-quit cleanup used to do
// `clearInterval(smarthomeRuleTimer); smarthomeRuleTimer = null;` directly;
// now routed through this cleanup function since the timer handle lives here.
export function stopSmarthomeRuleTimer() {
  if (smarthomeRuleTimer) {
    clearInterval(smarthomeRuleTimer);
    smarthomeRuleTimer = null;
  }
}
