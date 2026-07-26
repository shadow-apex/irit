// electron/action-lane.mjs
//
// Iris's Claude Code work (PO/DEV, see electron/run-queue.mjs) is
// deliberately single-slot: one continuous session, one task at a time, so
// `--resume` and session continuity keep working. That is correct for
// Claude Code — but it means anything routed through submit_claude_task
// waits behind whatever Claude is already doing.
//
// Not everything should wait. "Turn off the lights", "read this webpage",
// or a full computer-use run are independent of the Claude Code session and
// of each other (mostly) — they should run in parallel with it AND with
// each other, as long as two actions of the SAME kind don't fight over the
// same resource (e.g. two computer-use sessions both driving the mouse).
//
// This module is the multi-app orchestration primitive: named lanes, each
// with its own small concurrency cap, running completely outside
// run-queue.mjs's slot. It has no Electron/Gemini/Claude knowledge — same
// headless, dependency-injected shape as run-queue.mjs, so it can be used
// (and unit tested) on its own.

const LANE_LIMITS = {
  computer: 1, // one mouse/keyboard driver at a time — never let two fight
  browser: 2, // a couple of lightweight page tasks can overlap
  smarthome: 5, // device commands are cheap, independent, and numerous
  default: 2,
};

const lanes = new Map(); // laneName -> { running: Set<id>, queue: Job[] }
const actions = new Map(); // actionId -> record
const subscribers = new Set(); // callback fns

export function subscribeActionLanes(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notifySubscribers() {
  const active = listActiveActions();
  for (const fn of subscribers) {
    fn(active);
  }
}

let counter = 0;
function nextId(lane) {
  counter += 1;
  return `${lane}_${Date.now().toString(36)}_${counter}`;
}

function laneState(lane) {
  if (!lanes.has(lane)) lanes.set(lane, { running: new Set(), queue: [] });
  return lanes.get(lane);
}

function limitFor(lane) {
  return LANE_LIMITS[lane] ?? LANE_LIMITS.default;
}

function tryStart(lane) {
  const state = laneState(lane);
  while (state.running.size < limitFor(lane) && state.queue.length > 0) {
    const job = state.queue.shift();
    state.running.add(job.id);
    runJob(lane, job);
  }
}

async function runJob(lane, job) {
  const record = actions.get(job.id);
  record.status = "running";
  record.started_at = Date.now();
  notifySubscribers();
  job.onEvent?.({ status: "running", id: job.id, lane, label: record.label });
  try {
    const result = await job.fn(job.id);
    record.status = "completed";
    record.result = result;
    job.onEvent?.({ status: "completed", id: job.id, lane, label: record.label, result });
  } catch (error) {
    record.status = "error";
    record.error = error?.message || String(error);
    job.onEvent?.({ status: "error", id: job.id, lane, label: record.label, error: record.error });
  } finally {
    record.finished_at = Date.now();
    const state = laneState(lane);
    state.running.delete(job.id);
    notifySubscribers();
    tryStart(lane);
  }
}

/**
 * Submit a background action into a named lane. Returns immediately with
 * {id, status: "started"|"queued", position, lane} — never awaits the work
 * itself, so the caller (a Gemini tool handler) can reply to the voice
 * conversation right away while the action runs. `fn(id)` is the async
 * worker — it receives its own action id so long-running/cooperative
 * workers (like the computer-use loop) can poll isCancelled(id) themselves;
 * `onEvent` is an optional status-change hook (used to log progress and,
 * for terminal states, feed Iris's normal event stream).
 */
export function submitAction({ lane = "default", label = "", fn, onEvent } = {}) {
  if (typeof fn !== "function") throw new Error("submitAction requires 'fn'.");
  const id = nextId(lane);
  actions.set(id, {
    id,
    lane,
    label,
    status: "queued",
    started_at: null,
    finished_at: null,
    result: null,
    error: null,
  });
  const state = laneState(lane);
  const willStartNow = state.running.size < limitFor(lane);
  state.queue.push({ id, fn, onEvent });
  notifySubscribers();
  tryStart(lane);
  return {
    id,
    status: willStartNow ? "started" : "queued",
    position: willStartNow ? 0 : state.queue.length,
    lane,
  };
}

export function getActionStatus(id) {
  const record = actions.get(id);
  if (!record) return { status: "error", error: `Unknown action: ${id}` };
  return { ...record };
}

/** Actions still queued or running, newest first — for "what are you doing right now" voice queries. */
export function listActiveActions() {
  return Array.from(actions.values())
    .filter((a) => a.status === "queued" || a.status === "running")
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
}

/** Per-lane occupancy — used for a compact status readout across all lanes. */
export function laneSnapshot() {
  const snapshot = {};
  for (const [lane, state] of lanes.entries()) {
    snapshot[lane] = { running: state.running.size, queued: state.queue.length, limit: limitFor(lane) };
  }
  return snapshot;
}

/**
 * Best-effort cancel: removes a still-queued job so it never starts, or
 * marks a running one "cancelling" so a cooperative worker (one that checks
 * this flag, like the computer-use loop) can stop at its next safe point.
 * Returns false if the id is unknown or already finished.
 */
export function cancelAction(id) {
  const record = actions.get(id);
  if (!record || record.status === "completed" || record.status === "error" || record.status === "cancelled") {
    return false;
  }
  const state = laneState(record.lane);
  const queuedIndex = state.queue.findIndex((job) => job.id === id);
  if (queuedIndex !== -1) {
    state.queue.splice(queuedIndex, 1);
    record.status = "cancelled";
    record.finished_at = Date.now();
    notifySubscribers();
    return true;
  }
  // Already running: we can't forcibly kill an arbitrary async function
  // here, so just flag it — cooperative workers should poll isCancelled().
  record.status = "cancelling";
  notifySubscribers();
  return true;
}

export function isCancelled(id) {
  const record = actions.get(id);
  return record?.status === "cancelling" || record?.status === "cancelled";
}
