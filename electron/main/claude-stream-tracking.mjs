/**
 * electron/main/claude-stream-tracking.mjs
 *
 * Turns raw Claude Agent SDK stream chunks into the activity-log / tool
 * timeline events the renderer displays, and remembers session ids so a
 * workstream's next run can resume the right Claude session.
 */
import { parseClaudeStreamMessage } from "../claude-stream.mjs";
import { RUN_STATUS, toUpdateEvent } from "../run-queue.mjs";
import { emitEvent } from "./events.mjs";
import { findWorkstream, persistSessionStore, emitSessions } from "./session-store.mjs";
import { agentKey } from "./agent-roster.mjs";

export function rememberClaudeSessionId(run, claudeSessionId) {
  if (!claudeSessionId) return;
  run.claude_session_id = claudeSessionId;
  const workstream = findWorkstream(run.workstream_id);
  if (!workstream) return;
  const key = agentKey(run.agent);
  const changed =
    workstream.agent_sessions[key] !== claudeSessionId ||
    workstream.last_agent_used !== (run.agent ?? null);
  workstream.agent_sessions[key] = claudeSessionId;
  workstream.last_agent_used = run.agent ?? null;
  workstream.last_used_at = Date.now() / 1000;
  workstream.last_task = run.task.slice(0, 100);
  persistSessionStore();
  if (changed) emitSessions();
}

export function pushActivity(run, line) {
  const clean = String(line || "").trim();
  if (!clean) return;
  run.activity.push(clean.length > 220 ? `${clean.slice(0, 220)}…` : clean);
  if (run.activity.length > 80) run.activity.splice(0, run.activity.length - 80);
  emitEvent(toUpdateEvent(run, RUN_STATUS.RUNNING, { output: run.activity.join("\n") }));
}

// Live per-task step timeline: additive fields on the SAME claude_task_update
// projection (no new event type), keyed by Claude's own tool_use id so
// start/end pairing survives duplicate tool names within one run. See
// openspec/changes/two-hand-gestures-and-orb design.md D2.
export function pushToolStart(run, toolId, toolName, detail) {
  if (!toolId) return;
  if (!run.toolStartedAt) run.toolStartedAt = new Map();
  run.toolStartedAt.set(toolId, Date.now());
  emitEvent(
    toUpdateEvent(run, RUN_STATUS.RUNNING, { phase: "tool_start", tool: toolName, tool_id: toolId, detail }),
  );
}

export function pushToolEnd(run, toolId, isError) {
  if (!toolId) return;
  const startedAt = run.toolStartedAt?.get(toolId);
  const duration = startedAt ? (Date.now() - startedAt) / 1000 : undefined;
  run.toolStartedAt?.delete(toolId);
  emitEvent(
    toUpdateEvent(run, RUN_STATUS.RUNNING, { phase: "tool_end", tool_id: toolId, error: isError, duration }),
  );
}

export function handleClaudeStreamEvent(run, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  parseClaudeStreamMessage(event, {
    onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
    onActivity: (text) => pushActivity(run, text),
    onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
    onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
    onResult: (result) => {
      run.result = result;
      rememberClaudeSessionId(run, result.session_id);
    },
  });
}
