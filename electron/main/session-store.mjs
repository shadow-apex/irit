/**
 * electron/main/session-store.mjs
 *
 * The workstream/session store: persisted list of workstreams (projects the
 * user is working in), which agent (PO/DEV/STUDY) + model each one is bound
 * to, and the create/select/rename/close-out operations the renderer's
 * workstream switcher drives.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import electron from "electron";
const { dialog } = electron;
import { closePoSession } from "../po-session.mjs";
import { closeStudySession } from "../study-session.mjs";
import { AGENT_ROSTER, AGENT_LABELS, MODEL_IDS } from "./agent-roster.mjs";
import { notifyIris, announceAgentSelection } from "./notify-iris.mjs";
import { emitEvent } from "./events.mjs";
import { mainWindow } from "./window-manager.mjs";
import { PendingQuestion } from "./po-questions.mjs";
import { PendingReview } from "./task-review-flow.mjs";

export const SESSION_STORE = path.join(os.homedir(), ".iris", "claude-sessions.json");

export let sessionStore = { active: null, sessions: [] };

export function normalizeWorkstream(entry) {
  const workstream = { ...entry, cwd: typeof entry.cwd === "string" ? entry.cwd : null };
  if (!workstream.agent_sessions || typeof workstream.agent_sessions !== "object") {
    workstream.agent_sessions = {};
  }
  if (!workstream.agent_models || typeof workstream.agent_models !== "object") {
    workstream.agent_models = {};
  }
  if (typeof workstream.claude_session_id === "string" && workstream.claude_session_id) {
    workstream.agent_sessions.default = workstream.claude_session_id;
  }
  delete workstream.claude_session_id;
  if (!AGENT_ROSTER.includes(workstream.active_agent)) workstream.active_agent = null;
  // null means the last run used plain Claude (the "default" conversation).
  if (!AGENT_ROSTER.includes(workstream.last_agent_used)) workstream.last_agent_used = null;
  return workstream;
}

export function loadSessionStore() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_STORE, "utf8"));
    if (Array.isArray(data.sessions)) {
      sessionStore = {
        active: typeof data.active === "string" ? data.active : null,
        sessions: data.sessions
          .filter((entry) => entry && typeof entry.id === "string")
          .map(normalizeWorkstream),
      };
      // One-time cleanup: sessions created before auto-naming carry a
      // meaningless "Session N" label or an old-format auto label — possibly
      // named after a folder the session has since moved away from. Rename
      // them after their current project folder; blank the pending labels
      // first so they number 01, 02, … in list order.
      const knownBases = [
        ...new Set(
          sessionStore.sessions
            .map((entry) => (entry.cwd ? path.basename(entry.cwd) : null))
            .filter(Boolean),
        ),
      ];
      const isLegacyAutoLabel = (label) =>
        /^Session \d+$/.test(label) ||
        knownBases.some(
          (base) =>
            label === base ||
            (label.startsWith(`${base} · `) && /^\d+$/.test(label.slice(base.length + 3))),
        );
      const pending = sessionStore.sessions.filter(
        (workstream) =>
          workstream.cwd &&
          isLegacyAutoLabel(workstream.label) &&
          !(isAutoLabel(workstream.label, workstream.cwd) && / · \d{2}$/.test(workstream.label)),
      );
      for (const workstream of pending) workstream.label = "";
      for (const workstream of pending) {
        workstream.label = projectSessionLabel(workstream.cwd, workstream.id);
      }
      persistSessionStore();
      return;
    }
    // Migrate the legacy flat map { irisSessionId: claudeSessionId }.
    const now = Date.now() / 1000;
    const sessions = Object.entries(data)
      .filter(([, value]) => typeof value === "string" && value)
      .map(([key, value], index) => ({
        id: crypto.randomUUID(),
        label: key === "iris-voice" ? `Session ${index + 1}` : key,
        agent_sessions: { default: value },
        agent_models: {},
        active_agent: null,
        last_agent_used: null,
        cwd: null,
        created_at: now,
        last_used_at: now,
        last_task: "",
      }));
    sessionStore = { active: sessions[0]?.id ?? null, sessions };
    persistSessionStore();
  } catch { /* first run or unreadable store */ }
}

export function persistSessionStore() {
  try {
    fs.mkdirSync(path.dirname(SESSION_STORE), { recursive: true });
    fs.writeFileSync(SESSION_STORE, JSON.stringify(sessionStore, null, 2));
  } catch { /* non-fatal */ }
}

loadSessionStore();

export function findWorkstream(id) {
  return sessionStore.sessions.find((entry) => entry.id === id) || null;
}

export function sessionsSnapshot() {
  return { active: sessionStore.active, sessions: sessionStore.sessions };
}

export function emitSessions() {
  emitEvent({ type: "claude_session", ...sessionsSnapshot() });
}

// Sessions are named after their project: "<folder> · 01", "· 02", … so the
// list reads by project instead of by meaningless number. User-given labels
// are never touched; isAutoLabel() tells the two apart.
export function projectSessionLabel(cwd, excludeId) {
  if (!cwd) return null;
  const base = path.basename(cwd);
  // Next ordinal = highest existing one + 1, so renamed legacy labels
  // ("base · 2") and fresh padded ones ("base · 02") can never collide.
  let highest = 0;
  for (const entry of sessionStore.sessions) {
    if (entry.id === excludeId) continue;
    if (entry.label === base) {
      highest = Math.max(highest, 1);
    } else if (entry.label.startsWith(`${base} · `)) {
      const ordinal = Number.parseInt(entry.label.slice(base.length + 3), 10);
      if (Number.isFinite(ordinal)) highest = Math.max(highest, ordinal);
    }
  }
  return `${base} · ${String(highest + 1).padStart(2, "0")}`;
}

export function isAutoLabel(label, cwd) {
  if (/^Session \d+$/.test(label)) return true;
  if (!cwd) return false;
  const base = path.basename(cwd);
  return label === base || label.startsWith(`${base} · `);
}

export function createWorkstream(label) {
  const now = Date.now() / 1000;
  // A new session keeps working in the current project folder — switching
  // projects is an explicit action, not a side effect of a fresh session.
  const inheritedCwd = findWorkstream(sessionStore.active)?.cwd ?? null;
  const workstream = {
    id: crypto.randomUUID(),
    label:
      String(label || "").trim() ||
      projectSessionLabel(inheritedCwd) ||
      `Session ${sessionStore.sessions.length + 1}`,
    agent_sessions: {},
    agent_models: {},
    active_agent: null,
    last_agent_used: null,
    cwd: inheritedCwd,
    created_at: now,
    last_used_at: now,
    last_task: "",
  };
  sessionStore.sessions.push(workstream);
  const previousActiveId = sessionStore.active;
  sessionStore.active = workstream.id;
  persistSessionStore();
  emitSessions();
  announceWorkspaceUpdate();
  // Switching away from a workstream with a resident PO session: nothing will
  // deliver it another turn until the user switches back, so free the
  // subprocess now rather than leaving it idle indefinitely.
  if (previousActiveId && previousActiveId !== workstream.id) {
    PendingQuestion.abandon(previousActiveId);
    PendingReview.abandon(previousActiveId);
    closePoSession(previousActiveId);
    closeStudySession(previousActiveId);
  }
  return workstream;
}

export function activeWorkstream() {
  return findWorkstream(sessionStore.active) || createWorkstream();
}

export function selectWorkstream(id) {
  const workstream = findWorkstream(id);
  if (!workstream) return { status: "error", error: `Unknown session: ${id}` };
  const previousActiveId = sessionStore.active;
  sessionStore.active = workstream.id;
  persistSessionStore();
  emitSessions();
  announceWorkspaceUpdate();
  if (previousActiveId && previousActiveId !== workstream.id) {
    PendingQuestion.abandon(previousActiveId);
    PendingReview.abandon(previousActiveId);
    closePoSession(previousActiveId);
    closeStudySession(previousActiveId);
  }
  return { status: "ok", ...sessionsSnapshot() };
}

export function setWorkstreamCwd(id, dir) {
  const workstream = findWorkstream(id);
  if (!workstream) return { status: "error", error: `Unknown session: ${id}` };
  const cwd = String(dir || "").trim() || null;
  if (cwd && !fs.existsSync(cwd)) {
    return { status: "error", error: `Folder not found: ${cwd}` };
  }
  if (workstream.cwd !== cwd) {
    const wasAutoNamed = isAutoLabel(workstream.label, workstream.cwd);
    // Claude Code stores conversations per project directory, so session ids
    // recorded in the old folder cannot be resumed from the new one. A resident
    // PO or STUDY session is bound to the OLD cwd, so both must end here too —
    // otherwise their next turn would run in a directory they no longer match.
    PendingQuestion.abandon(workstream.id);
    PendingReview.abandon(workstream.id);
    closePoSession(workstream.id);
    closeStudySession(workstream.id);
    workstream.agent_sessions = {};
    workstream.last_agent_used = null;
    workstream.cwd = cwd;
    if (cwd && wasAutoNamed) {
      workstream.label = projectSessionLabel(cwd, workstream.id);
    }
    persistSessionStore();
    emitSessions();
    announceWorkspaceUpdate();
    emitEvent({
      type: "log",
      level: "info",
      message: `Claude session "${workstream.label}" now works in ${cwd || "the default workspace"} (fresh Claude context).`,
    });
  }
  return { status: "ok", ...sessionsSnapshot() };
}

// Selecting a role never touches stored sessions — each role keeps its own
// continuous conversation, so flipping the picker back and forth costs nothing.
export function setWorkstreamAgent(id, agent) {
  const workstream = findWorkstream(id);
  if (!workstream) return { status: "error", error: `Unknown session: ${id}` };
  const clean = agent ? String(agent).trim().toLowerCase() : null;
  if (clean !== null && !AGENT_ROSTER.includes(clean)) {
    return { status: "error", error: `Unknown agent: ${agent}` };
  }
  if (workstream.active_agent !== clean) {
    workstream.active_agent = clean;
    persistSessionStore();
    emitSessions();
    announceWorkspaceUpdate();
    announceAgentSelection(workstream);
  }
  return { status: "ok", ...sessionsSnapshot() };
}

// Shared by the UI (agents:set-model IPC) and the Gemini voice tool
// (set_agent_model) — a single choke point so both paths can never diverge.
// If PO's model changes while its live session is resident, the change is
// applied via setModel() on the next run start (see startPoRun), never by
// closing/resuming the session — that would needlessly drop context.
export function setAgentModel(workstreamId, role, model) {
  const workstream = findWorkstream(workstreamId);
  if (!workstream) return { status: "error", error: `Unknown session: ${workstreamId}` };
  const cleanRole = String(role || "").trim().toLowerCase();
  if (!AGENT_ROSTER.includes(cleanRole)) {
    return { status: "error", error: `Model selection is only available for the ${AGENT_ROSTER.map((r) => AGENT_LABELS[r]).join("/")} roles, not "${role}".` };
  }
  const cleanModel = String(model || "").trim();
  if (!MODEL_IDS.has(cleanModel)) {
    return { status: "error", error: `Unknown model: ${model}` };
  }
  if (workstream.agent_models[cleanRole] !== cleanModel) {
    workstream.agent_models[cleanRole] = cleanModel;
    persistSessionStore();
    emitEvent({ type: "agent_model_update", workstream_id: workstream.id, role: cleanRole, model: cleanModel });
  }
  return { status: "ok", ...sessionsSnapshot() };
}

export async function chooseWorkstreamCwd(id) {
  const workstream = findWorkstream(id) || activeWorkstream();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose the project folder Claude works in",
    defaultPath: workstream.cwd || os.homedir(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { status: "cancelled", ...sessionsSnapshot() };
  }
  return setWorkstreamCwd(workstream.id, result.filePaths[0]);
}

// What Iris (the voice model) is allowed to know about the current workspace:
// the active session, its project folder, and the active pipeline role.
export function workspaceInfo() {
  const workstream = findWorkstream(sessionStore.active);
  const cwd = workstream?.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
  return {
    session_label: workstream?.label ?? null,
    project_folder: cwd,
    project_name: cwd ? path.basename(cwd) : null,
    active_role: workstream?.active_agent ? AGENT_LABELS[workstream.active_agent] : null,
    note: cwd
      ? `Claude's file/terminal work for this session happens inside ${cwd}.`
      : "No project folder is selected for this session — Claude falls back to the default workspace (~/.iris/workspace). The user can pick a folder from the UI.",
  };
}

export function workspaceContextLine() {
  const info = workspaceInfo();
  const folder = info.project_folder
    ? `project folder ${info.project_folder} (project "${info.project_name}")`
    : "no project folder selected yet (Claude falls back to the default workspace)";
  const role = info.active_role ? `, active role: ${info.active_role}` : "";
  return `Current workspace: session "${info.session_label ?? "none"}", ${folder}${role}.`;
}

// Keep the live voice session in sync when the user changes workspace state
// from the UI — otherwise Iris only ever knows what the system prompt said at
// connect time and cannot answer "which project are we working in?".
export function announceWorkspaceUpdate() {
  notifyIris([
    "SYSTEM_EVENT_WORKSPACE_UPDATE",
    workspaceContextLine(),
    "instructions_to_iris: silently remember this as the current workspace state. Do NOT speak or respond to this message.",
  ]);
}

export function userDisplayName() {
  return (process.env.IRIS_USER_NAME || process.env.USER || process.env.USERNAME || "there").trim();
}
