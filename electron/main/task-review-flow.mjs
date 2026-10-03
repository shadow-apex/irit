/**
 * electron/main/task-review-flow.mjs
 *
 * The DEV "review my finished task" flow: pending-review state, notifying
 * the user a task is parked awaiting review, and approve/respond/cancel.
 */
import { resolveApprovedTask } from "../task-review.mjs";
import { emitEvent } from "./events.mjs";
import { notifyIris } from "./notify-iris.mjs";
import { findWorkstream } from "./session-store.mjs";
import { dispatchClaudeRun } from "./claude-runner.mjs";

export const PendingReview = {
  current: null, // { workstream_id, task, urgency, agent, timer }

  raise(parked, { timeoutMs }) {
    this.clear(); // at most one pending review — a new submit supersedes silently
    const timer = setTimeout(() => this.expire(), timeoutMs);
    timer.unref?.();
    this.current = { ...parked, timer };
    emitTaskReviewEvent(this.current, "pending");
  },

  clear(status) {
    if (!this.current) return null;
    const { timer, ...parked } = this.current;
    clearTimeout(timer);
    this.current = null;
    if (status) emitTaskReviewEvent(parked, status);
    return parked;
  },

  expire() {
    const parked = this.clear("timed_out");
    if (parked) notifyTaskReviewResolved("timed_out", parked, "The review timed out and was not sent to Claude.");
  },

  abandon(workstreamId) {
    if (!this.current || this.current.workstream_id !== workstreamId) return;
    const parked = this.clear("abandoned");
    if (parked) {
      notifyTaskReviewResolved("abandoned", parked, "The session changed, so the parked brief was discarded and not sent.");
    }
  },
};

export function emitTaskReviewEvent(parked, status) {
  emitEvent({
    type: "task_review",
    workstream_id: parked.workstream_id,
    status,
    task: parked.task,
    urgency: parked.urgency,
    agent: parked.agent,
  });
}

export function notifyTaskReviewParked(parked) {
  notifyIris([
    "SYSTEM_EVENT_TASK_REVIEW_PARKED",
    `agent: ${parked.agent ?? "none"}`,
    "instructions_to_iris:",
    "- Review mode is on: the brief you just submitted was parked, not sent to Claude — zero tokens spent so far.",
    "- Speak a SHORT 1-2 sentence summary of the brief you just wrote (do not read it verbatim), say the full brief is on screen, then wait. Do not say it started or is queued.",
    "- Do NOT call get_claude_task_status for this — there is no run yet.",
    "- The user may approve (optionally after editing), or cancel — from the screen, or by telling you so you can call respond_to_task_review. If they resolve it from the screen, you will receive SYSTEM_EVENT_TASK_REVIEW_RESOLVED instead.",
  ].join("\n"));
}

// Injected on any resolution the voice layer did NOT itself initiate — a
// UI-driven approve/cancel, a timeout, or a reset-abandon. respond_to_task_review's
// own synchronous tool return already tells Gemini the outcome when IT
// resolves the review, so that path never also calls this.
export function notifyTaskReviewResolved(outcome, parked, detail) {
  notifyIris([
    "SYSTEM_EVENT_TASK_REVIEW_RESOLVED",
    `outcome: ${outcome}`,
    "instructions_to_iris:",
    detail ? `- ${detail}` : `- The parked brief was resolved (${outcome}).`,
    "- This did not come from your own respond_to_task_review call — the user acted from the screen, or it timed out/was abandoned. Announce it naturally; do not re-send the brief yourself.",
  ].join("\n"));
}

export function cancelTaskReview({ notify } = {}) {
  const parked = PendingReview.clear("cancelled");
  if (!parked) return { status: "error", error: "No task review is pending." };
  if (notify) notifyTaskReviewResolved("cancelled", parked, "The brief was cancelled and was not sent to Claude.");
  return { status: "ok" };
}

// Approve dispatches against the PARKED workstream_id, never a fresh
// activeWorkstream() read — the user may have switched workstreams while the
// review sat parked. editedTaskRaw is validated by the pure helper from
// task-review.mjs: undefined/null falls back to the parked task; an
// explicitly empty edit is refused WITHOUT clearing the pending review, so
// the banner stays up and the user can fix it.
export function approveTaskReview(editedTaskRaw, { notify } = {}) {
  const pending = PendingReview.current;
  if (!pending) return { status: "error", error: "No task review is pending." };
  let finalTask;
  try {
    finalTask = resolveApprovedTask(editedTaskRaw, pending.task);
  } catch (error) {
    return { status: "error", error: error.message };
  }
  const parked = PendingReview.clear("approved");
  const workstream = findWorkstream(parked.workstream_id);
  if (!workstream) {
    const message = "That session no longer exists — the brief was not sent.";
    if (notify) notifyTaskReviewResolved("error", parked, message);
    return { status: "error", error: message };
  }
  const result = dispatchClaudeRun({ task: finalTask, urgency: parked.urgency, agent: parked.agent, workstream });
  if (notify) notifyTaskReviewResolved(result.status, parked, result.message);
  return result;
}

// Voice tool `respond_to_task_review` — its own synchronous tool return IS
// Gemini's notification of the outcome, so this path never also calls
// notifyTaskReviewResolved (reserved for channels Gemini did not initiate).
// Editing is deck-only, same as PO answers: voice can only approve as-is or
// cancel, never supply edited text.
export function respondToTaskReview({ decision } = {}) {
  const normalized = String(decision || "").trim().toLowerCase();
  if (normalized === "approve") return approveTaskReview(undefined, { notify: false });
  if (normalized === "cancel") return cancelTaskReview({ notify: false });
  return { status: "error", error: `Unknown decision "${decision}" — expected "approve" or "cancel".` };
}

// IPC entry point for the deck's ReviewBanner (Approve/Cancel, possibly with
// an edited brief).
export function resolvePromptReview({ action, editedTask } = {}) {
  if (action === "approve") return approveTaskReview(editedTask, { notify: true });
  if (action === "cancel") return cancelTaskReview({ notify: true });
  return { status: "error", error: `Unknown review action "${action}".` };
}
