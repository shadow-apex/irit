/**
 * electron/main/claude-runner.mjs
 *
 * Spawning and streaming headless `claude` CLI runs for DEV, and turn
 * delivery for the resident PO/STUDY agent sessions. Owns the run queue
 * (one active run at a time) and the Telegram "run finished" notification.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRunQueue, RUN_STATUS, EMIT_STATUS, toUpdateEvent } from "../run-queue.mjs";
import { initTelegramBot } from "../telegram-bot.mjs";
import { initWebServer } from "../web-server.mjs";
import { sendCommand } from "./gemini-live.mjs";
import {
  getOrCreatePoSession,
  deliverPoTurn,
  setPoSessionModel,
  poBillingStatus,
} from "../po-session.mjs";
import {
  getOrCreateStudySession,
  deliverStudyTurn,
  setStudySessionModel,
  studyBillingStatus,
} from "../study-session.mjs";
import { AGENT_ROSTER, AGENT_LABELS, AGENT_PREFIX, MODEL_CHOICES, resolveAgentModel, agentKey } from "./agent-roster.mjs";
import { emitEvent } from "./events.mjs";
import { notifyIris } from "./notify-iris.mjs";
import {
  userDisplayName,
  findWorkstream,
  activeWorkstream,
  createWorkstream,
  setAgentModel,
} from "./session-store.mjs";
import { canvasCapability, secondBrainCapability } from "./capabilities.mjs";
import { claudeBinary, openChangesWithTasks } from "./claude-cli.mjs";
import { getPromptReviewMode, promptReviewTimeoutMs } from "./env-config.mjs";
import { PendingReview, notifyTaskReviewParked } from "./task-review-flow.mjs";
import { installedAgentFile, ensureProjectScaffold, runProjectDir } from "./agents-install.mjs";
import { rememberClaudeSessionId, pushActivity, pushToolStart, pushToolEnd, handleClaudeStreamEvent } from "./claude-stream-tracking.mjs";
import { persistSessionStore } from "./session-store.mjs";
import { askUserQuestionViaVoice } from "./po-questions.mjs";

export let hasReportedMissingClaudeKey = false;

export const runQueue = createRunQueue({
  startRun: startClaudeRun,
  emit: emitEvent,
  onFinalized: (run) => {
    announceClaudeCompletion({
      runId: run.run_id,
      task: run.task,
      status: run.status,
      output: String(run.output || "").slice(0, 2500),
    });

    const outputString = String(run.output || "");
    const isMissingClaude = outputString.includes("claude is not recognized") || outputString.includes("No CLAUDE_CODE_OAUTH_TOKEN");

    if (isMissingClaude) {
      if (!hasReportedMissingClaudeKey) {
        hasReportedMissingClaudeKey = true;
        sendTelegramMessage(`Task ${run.status}:\n${run.task}\n\nOutput:\n${outputString.slice(0, 1500)}\n\n(I will stop reporting this specific Claude API/CLI error to avoid spamming you).`);
        sendWebMessage(`Task ${run.status}:\n${run.task}\n\nOutput:\n${outputString.slice(0, 1500)}\n\n(I will stop reporting this specific Claude API/CLI error to avoid spamming you).`);
      }
    } else {
      sendTelegramMessage(`Task ${run.status}:\n${run.task}\n\nOutput:\n${outputString.slice(0, 1500)}`);
      sendWebMessage(`Task ${run.status}:\n${run.task}\n\nOutput:\n${outputString.slice(0, 1500)}`);
    }
  }
});

export let sendTelegramMessage = () => { };
export let sendWebMessage = () => { };

// Initialize Telegram bot after environment variables are loaded
setTimeout(() => {
  sendTelegramMessage = initTelegramBot({
    submitTask: (args) => submitClaudeTask(args),
    getStatus: () => {
      const r = runQueue.get(runQueue.active);
      return r ? `${r.status} (Task: ${r.task})` : "Idle";
    },
    log: (level, msg) => emitEvent({ type: "log", level, message: msg })
  });

  sendWebMessage = initWebServer({
    submitTask: (args) => submitClaudeTask(args),
    sendToGemini: (text) => sendCommand({ type: "text", text }),
    getStatus: () => {
      const r = runQueue.get(runQueue.active);
      return r ? `${r.status} (Task: ${r.task})` : "Idle";
    },
    log: (level, msg) => emitEvent({ type: "log", level, message: msg })
  });
}, 0);

export function startClaudeRun(run) {
  run.cwd = runProjectDir(run);

  // A run submitted for a role must run AS that role — falling back to plain
  // Claude would silently skip the gate the user thinks they are in.
  if (run.agent && !installedAgentFile(run.agent, run.cwd)) {
    runQueue.finalize(
      run.run_id,
      RUN_STATUS.FAILED,
      `The ${AGENT_LABELS[run.agent] ?? run.agent} agent is not installed (missing ${AGENT_PREFIX}${run.agent}.md). Click "Install agents" in the Iris session bar, then retry.`,
    );
    return;
  }

  // STUDY is a standalone learning role, not part of the PO → DEV build
  // pipeline: it skips OpenSpec scaffolding AND the DEV change-gate entirely,
  // runs in the workstream cwd (to read the material being studied), and writes
  // notes to the second-brain vault. Route it before either step ever runs.
  if (run.agent === "study") {
    startStudyRun(run);
    return;
  }

  // First role run in a fresh project: make it OpenSpec-ready (`openspec init`)
  // so the PO can propose changes and the DEV can implement their tasks.
  if (run.agent) {
    const scaffold = ensureProjectScaffold(run.cwd);
    if (scaffold.created.length) {
      emitEvent({
        type: "log",
        level: "info",
        message: `Set up ${run.cwd} for the agent pipeline: ${scaffold.created.join(", ")}.`,
      });
    }
    if (scaffold.error) {
      emitEvent({ type: "log", level: "warn", message: `Project setup incomplete (${scaffold.error}) — the run continues anyway.` });
    }
  }

  // DEV runs only against an open OpenSpec change with unchecked tasks (see the
  // po-voice-controller change / openspec-native-pipeline spec). No open change
  // with work means the PO has not proposed yet — fail loudly rather than let
  // DEV free-code without a spec, and tell the user to have the PO propose first.
  if (run.agent === "dev" && !openChangesWithTasks(run.cwd).length) {
    runQueue.finalize(
      run.run_id,
      RUN_STATUS.FAILED,
      "No open OpenSpec change with remaining tasks to implement. Ask the PO to grill and propose a change first (it creates openspec/changes/<name>/tasks.md), then run the DEV.",
    );
    return;
  }

  // Rollback switch for the stateful PO module (design.md Migration Plan):
  // set IRIS_PO_LIVE_SESSION=0 to fall back to the pre-SDK behavior, where PO
  // runs exactly like DEV (one-shot `claude -p --resume`, no live session, no
  // mid-turn questions). No data migration needed — both paths read/write the
  // same workstream.agent_sessions.po id.
  if (run.agent === "po" && process.env.IRIS_PO_LIVE_SESSION !== "0") {
    startPoRun(run);
    return;
  }
  startDevRun(run);
}

// The stateless module: unchanged one-shot `claude -p` subprocess per run,
// exactly as before this change — mechanism AND auth (process.env, `/login`).
export async function startDevRun(run) {
  // Model is resolved at run START (not at submit time), so a model change
  // made while this task was queued still applies — see design.md D4. Only
  // role runs are model-selectable; plain Claude gets no --model flag and no
  // --fallback-model is ever set (an unavailable model must fail loudly, not
  // silently downgrade — see design.md D6).
  const workstream = findWorkstream(run.workstream_id);
  run.model = run.agent ? resolveAgentModel(workstream, run.agent) : null;

  // DEV (stateless module): never asks mid-run, always defaults. The PO
  // (stateful module, see startPoRun) gets the opposite instruction — it is
  // allowed to pause via AskUserQuestion — so the two must not share this string.
  let systemPrompt =
    "You are invoked from Iris voice. Work autonomously. Do not ask for clarification unless absolutely impossible. Use sensible defaults and report concise final results.";

  // Personal-knowledge-notes capability (ported from myiris): plain-Claude
  // runs only (`!run.agent`) — PO/DEV/STUDY must see this exact string
  // unchanged, so this whole branch is skipped whenever run.agent is set.
  if (!run.agent) {
    secondBrainCapability.ensureNotesVaultReady();
    if (secondBrainCapability.checkNotesSkillsStatus().ok) {
      systemPrompt += ` The personal-notes / LLM-Wiki vault root is fixed at ${secondBrainCapability.notesVaultDir}, regardless of the current working directory — use the wiki skills there for any note-taking or second-brain request. wiki-config.md and wiki-schema.md already exist in that vault; never ask the user for the wiki root path or wait for a reply — proceed directly using this path.`;
    } else {
      systemPrompt += " The personal-notes / LLM-Wiki skills are not installed on this machine yet. If the user asks to capture, save, or retrieve a personal note or second-brain entry, tell them the notes capability needs to be installed first (Iris's setup panel, \"Install missing\") — do not attempt an ad-hoc note file in its place.";
    }
  }

  const args = [
    "-p", run.task,
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", process.env.IRIS_CLAUDE_PERMISSION_MODE || "bypassPermissions",
    "--append-system-prompt",
    systemPrompt,
  ];
  if (run.agent) args.push("--agent", `${AGENT_PREFIX}${run.agent}`);
  if (run.model) args.push("--model", run.model);

  // canvas-claude-mcp (ported from myiris): Iris-scoped per-run wiring, never
  // written to ~/.claude. A 0600 temp file (not inline argv) so the bearer
  // token isn't visible via `ps`; deleted once the run's own process ends —
  // cleanupMcpConfig() is idempotent and safe to call from every exit path.
  const mcpRecord = await canvasCapability.ensureCanvasMcpForRun();
  let mcpConfigDir = null;
  if (mcpRecord) {
    mcpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-mcp-"));
    const mcpConfigPath = path.join(mcpConfigDir, "mcp-config.json");
    fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { "iris-canvas": mcpRecord } }), { mode: 0o600 });
    args.push("--mcp-config", mcpConfigPath);
  }
  function cleanupMcpConfig() {
    if (mcpConfigDir) fs.rmSync(mcpConfigDir, { recursive: true, force: true });
    mcpConfigDir = null;
  }

  // CONTEXT IS USER-CONTROLLED. Every role (and plain Claude) keeps its OWN
  // continuous conversation within this workstream: a task always --resumes the
  // role's stored session, no matter what ran in between. Nothing here ever
  // drops a session on its own — context resets only when the USER asks for it:
  // the "New" session button, an explicit voice new-session request, or picking
  // a different project folder (Claude stores conversations per directory).
  // Cross-role context still crosses the PO → DEV gate via the handoff files in
  // the project, never via a shared conversation.
  const key = agentKey(run.agent);
  const previousSession = workstream?.agent_sessions?.[key] ?? null;
  if (previousSession) args.push("--resume", previousSession);

  let child;
  try {
    child = spawn(claudeBinary(), args, {
      cwd: run.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: process.platform === "win32"
    });
  } catch (error) {
    cleanupMcpConfig();
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to launch claude: ${error.message}`);
    return;
  }

  run.status = RUN_STATUS.RUNNING;
  run.started_at = Date.now() / 1000;
  run.child = child;
  // The id the run will resume (if any) — replaced by the live id once
  // Claude's init event confirms it.
  run.claude_session_id = previousSession ?? null;
  emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

  let stdoutBuffer = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) handleClaudeStreamEvent(run, line);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => {
    cleanupMcpConfig();
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to launch claude: ${error.message}`);
  });
  child.on("close", (code) => {
    cleanupMcpConfig();
    if (run.status === RUN_STATUS.CANCELLED) {
      runQueue.finalize(run.run_id, RUN_STATUS.CANCELLED, "Run was stopped before completion.");
      return;
    }
    const result = run.result;
    if (code === 0 && result && !result.is_error) {
      runQueue.finalize(run.run_id, RUN_STATUS.COMPLETED, String(result.result ?? ""));
    } else {
      const detail = result?.result || stderr.trim() || `claude exited with code ${code}`;
      // A dead --resume id (deleted history, moved project) would otherwise fail
      // every subsequent task; dropping it lets the next run start fresh.
      if (previousSession && /no conversation|session.*not.*found|unknown session/i.test(String(detail))) {
        const ws = findWorkstream(run.workstream_id);
        if (ws?.agent_sessions?.[key] === previousSession) {
          delete ws.agent_sessions[key];
          persistSessionStore();
        }
      }
      runQueue.finalize(run.run_id, RUN_STATUS.FAILED, String(detail));
    }
  });
}

// The stateful module: delivers the turn into the workstream's resident Agent
// SDK session (creating it on the first PO turn), instead of spawning a new
// process. See electron/po-session.mjs and design.md D1/D2/D3.
export function startPoRun(run) {
  const workstream = findWorkstream(run.workstream_id);
  if (!workstream) {
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, "Unknown workstream for PO run.");
    return;
  }
  const billing = poBillingStatus();
  if (!billing.ok) {
    runQueue.finalize(
      run.run_id,
      RUN_STATUS.FAILED,
      "PO needs a subscription token: run `claude setup-token`, set CLAUDE_CODE_OAUTH_TOKEN (see .env.example), then retry. DEV is unaffected.",
    );
    return;
  }

  // Resolved at run start (not submit time) so a model change made while this
  // task was queued still applies — see design.md D5.
  run.model = resolveAgentModel(workstream, "po");

  run.status = RUN_STATUS.RUNNING;
  run.started_at = Date.now() / 1000;
  run.claude_session_id = workstream.agent_sessions?.po ?? null;
  emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

  let state;
  try {
    state = getOrCreatePoSession(workstream, {
      agent: `${AGENT_PREFIX}po`,
      cwd: run.cwd,
      resumeSessionId: workstream.agent_sessions?.po ?? null,
      claudeExecutable: claudeBinary(),
      onAskUserQuestion: (workstreamId, questions) => askUserQuestionViaVoice(workstreamId, questions, "po"),
      model: run.model,
    });
  } catch (error) {
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to start PO session: ${error.message}`);
    return;
  }

  // The session may already be live on an older model (created before a
  // queued model change) — switch it via setModel() so the turn about to run
  // uses the current choice with the session's context fully preserved,
  // instead of closing/resuming just to change models.
  const modelReady =
    state.currentModel === run.model ? Promise.resolve() : setPoSessionModel(state, run.model);

  modelReady
    .catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not switch PO's live session model: ${error.message}` });
    })
    .then(() =>
      deliverPoTurn(state, run.task, {
        onActivity: (line) => pushActivity(run, line),
        onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
        onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
        onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
      }),
    )
    .then((result) => runQueue.finalize(run.run_id, result.status, result.output))
    .catch((error) => runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `PO session error: ${error.message}`));
}

// The stateful STUDY module: delivers the turn into the workstream's resident
// STUDY Agent SDK session (creating it on the first STUDY turn), mirroring PO
// but through the isolated electron/study-session.mjs. STUDY skips OpenSpec
// entirely (handled in startClaudeRun) and writes to the second-brain vault.
export function startStudyRun(run) {
  const workstream = findWorkstream(run.workstream_id);
  if (!workstream) {
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, "Unknown workstream for STUDY run.");
    return;
  }
  const billing = studyBillingStatus();
  if (!billing.ok) {
    runQueue.finalize(
      run.run_id,
      RUN_STATUS.FAILED,
      "STUDY needs a subscription token: run `claude setup-token`, set CLAUDE_CODE_OAUTH_TOKEN (see .env.example), then retry. DEV is unaffected.",
    );
    return;
  }

  // Resolved at run start (not submit time) so a model change made while this
  // task was queued still applies — same rule as PO/DEV.
  run.model = resolveAgentModel(workstream, "study");

  run.status = RUN_STATUS.RUNNING;
  run.started_at = Date.now() / 1000;
  run.claude_session_id = workstream.agent_sessions?.study ?? null;
  emitEvent(toUpdateEvent(run, EMIT_STATUS.STARTED, { urgency: run.urgency }));

  let state;
  try {
    state = getOrCreateStudySession(workstream, {
      agent: `${AGENT_PREFIX}study`,
      cwd: run.cwd,
      resumeSessionId: workstream.agent_sessions?.study ?? null,
      claudeExecutable: claudeBinary(),
      onAskUserQuestion: (workstreamId, questions) => askUserQuestionViaVoice(workstreamId, questions, "study"),
      model: run.model,
    });
  } catch (error) {
    runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `Failed to start STUDY session: ${error.message}`);
    return;
  }

  // Apply a queued model change to an already-live session without dropping its
  // context — identical to PO's setModel() path.
  const modelReady =
    state.currentModel === run.model ? Promise.resolve() : setStudySessionModel(state, run.model);

  modelReady
    .catch((error) => {
      emitEvent({ type: "log", level: "warn", message: `Could not switch STUDY's live session model: ${error.message}` });
    })
    .then(() =>
      deliverStudyTurn(state, run.task, {
        onActivity: (line) => pushActivity(run, line),
        onSessionId: (sessionId) => rememberClaudeSessionId(run, sessionId),
        onToolStart: (toolId, toolName, detail) => pushToolStart(run, toolId, toolName, detail),
        onToolEnd: (toolId, isError) => pushToolEnd(run, toolId, isError),
      }),
    )
    .then((result) => runQueue.finalize(run.run_id, result.status, result.output))
    .catch((error) => runQueue.finalize(run.run_id, RUN_STATUS.ERROR, `STUDY session error: ${error.message}`));
}

export async function submitClaudeTask({ task, urgency = "normal", agent } = {}) {
  if (!task || !String(task).trim()) {
    return { status: "error", error: "Task is required." };
  }
  const cleanTask = String(task).trim();
  const workstream = activeWorkstream();

  // Review gate (ported from myiris, prompt-review-gate spec): park instead
  // of dispatching. Zero tokens spent — no run, no run_id — until approved.
  if (getPromptReviewMode()) {
    const parked = {
      workstream_id: workstream.id,
      task: cleanTask,
      urgency,
      agent: agent ? String(agent).trim().toLowerCase() : null,
    };
    PendingReview.raise(parked, { timeoutMs: promptReviewTimeoutMs() });
    notifyTaskReviewParked(parked);
    return {
      status: "parked_for_review",
      workstream_id: workstream.id,
      message: "The brief is parked for the user's review — nothing has been sent to Claude yet.",
    };
  }
  return dispatchClaudeRun({ task: cleanTask, urgency, agent, workstream });
}

// The actual enqueue path, factored out of submitClaudeTask so
// approveTaskReview (below) dispatches through the exact same logic once a
// parked brief is approved — never a second, drifting copy of this.
export function dispatchClaudeRun({ task, urgency = "normal", agent, workstream }) {
  const cleanTask = String(task).trim();
  // The role is captured at enqueue time: a queued task keeps the agent it was
  // submitted under even if the user flips the pipeline picker afterwards.
  // Gemini may name a role explicitly; anything not in the roster is ignored.
  const requestedAgent = agent ? String(agent).trim().toLowerCase() : null;
  if (requestedAgent && !AGENT_ROSTER.includes(requestedAgent)) {
    emitEvent({ type: "log", level: "warn", message: `Ignoring unknown agent "${agent}" — using the session's active agent.` });
  }
  const runAgent = AGENT_ROSTER.includes(requestedAgent) ? requestedAgent : workstream.active_agent ?? null;
  const agentLabel = runAgent ? `${AGENT_LABELS[runAgent]} agent` : "Claude";
  const projectFolder = workstream.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
  const whereNote = projectFolder
    ? `Working in project folder ${projectFolder}.`
    : "No project folder is selected — working in the default workspace.";
  const runId = crypto.randomUUID();
  const run = {
    run_id: runId,
    workstream_id: workstream.id,
    session_label: workstream.label,
    task: cleanTask,
    urgency,
    agent: runAgent,
    status: RUN_STATUS.QUEUED,
    output: "",
    activity: [],
    queued_at: Date.now() / 1000,
    child: null,
  };

  const outcome = runQueue.submit(run);
  if (outcome.status === "queued") {
    return {
      status: "queued",
      run_id: runId,
      position: outcome.position,
      project_folder: projectFolder,
      message: `Claude is still finishing the current task. This one is queued at position ${outcome.position} for the ${agentLabel} and will start automatically. ${whereNote}`,
    };
  }
  return {
    status: "started",
    run_id: runId,
    agent: runAgent,
    project_folder: projectFolder,
    message: `${runAgent ? `Claude's ${agentLabel} has started the task.` : "Claude has started the task."} ${whereNote}`,
  };
}

export async function startNewClaudeSession({ label } = {}) {
  const workstream = createWorkstream(label);
  emitEvent({ type: "log", level: "info", message: `Claude: started a fresh session (${workstream.label}).` });
  return {
    status: "ok",
    message: `Started a fresh Claude session named ${workstream.label}. New tasks begin with a clean slate; tasks already running are not affected.`,
    session: { id: workstream.id, label: workstream.label },
  };
}

export async function getClaudeTaskStatus({ run_id }) {
  const serialized = runQueue.serialize(run_id);
  if (!serialized) return { status: "error", error: `Unknown run: ${run_id}` };
  return serialized;
}

export async function stopClaudeTask({ run_id }) {
  const status = runQueue.stop(run_id);
  if (status == null) return { status: "error", error: `Unknown run: ${run_id}` };
  return { status, run_id };
}

export function setAgentModelTool({ role, model } = {}) {
  const workstream = activeWorkstream();
  const result = setAgentModel(workstream.id, role, model);
  if (result.status === "error") return result;
  const label = MODEL_CHOICES.find((choice) => choice.id === model)?.label ?? model;
  return { status: "ok", message: `${AGENT_LABELS[role] ?? role}'s model is now ${label}.` };
}

export function announceClaudeCompletion({ runId, task, status, output }) {
  const eventText = [
    "SYSTEM_EVENT_CLAUDE_COMPLETE",
    `run_id: ${runId}`,
    `status: ${status}`,
    `original_task: ${task}`,
    "instructions_to_iris:",
    `- Proactively tell ${userDisplayName()} Claude has returned.`,
    "- If another conversation is in progress, politely pause it with a short bridge like: Quick update, Claude is back with a result.",
    "- Give a concise spoken summary in 1-3 sentences.",
    "- If the result contains a 'Decisions needed' section, read each decision aloud with its numbered options and the recommendation, collect the user's choice, then submit a follow-up task to the SAME role stating the chosen options.",
    "- Ask whether he wants to go through the details before continuing the current conversation.",
    "- Do not say you personally did the work; Claude did.",
    "claude_result:",
    output || "(Claude returned no text output.)",
  ].join("\n");

  emitEvent({
    type: "claude_completion",
    run_id: runId,
    task,
    status,
    output,
  });

  notifyIris(eventText);
}
