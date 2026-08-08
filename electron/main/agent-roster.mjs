/**
 * electron/main/agent-roster.mjs
 *
 * Static roster of PO/DEV/STUDY agents, per-role model choices, and the
 * model-resolution helper used when starting a Claude run.
 */

export const AGENT_ROSTER = ["po", "dev", "study"];
export const AGENT_PREFIX = "iris-";
export const AGENT_LABELS = { po: "PO", dev: "DEV", study: "Study" };
// Roles removed when the pipeline was collapsed to PO → DEV; their installed
// agent files are cleaned up on install.
export const RETIRED_AGENTS = ["ba", "test", "devops"];

// Curated model choices for the PO/DEV/STUDY roles — plain Claude keeps the
// CLI default and is not part of this list. PO defaults to the strongest model
// for product thinking; DEV defaults to the cheaper/faster one for routine
// implementation and can be raised to debug a hard issue; STUDY defaults to
// Sonnet for synthesis and fact-checking.
export const MODEL_CHOICES = [
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];
export const MODEL_IDS = new Set(MODEL_CHOICES.map((choice) => choice.id));
export const MODEL_DEFAULTS = { po: "claude-fable-5", dev: "claude-sonnet-5", study: "claude-sonnet-5" };
export const MODEL_ENV_VARS = { po: "IRIS_PO_MODEL", dev: "IRIS_DEV_MODEL", study: "IRIS_STUDY_MODEL" };

// Resolution order: the workstream's own choice, then the role's env override,
// then the hardcoded default. Plain Claude (role === null) never gets a model
// — it keeps whatever the CLI defaults to.
export function resolveAgentModel(workstream, role) {
  if (!role) return null;
  const stored = workstream?.agent_models?.[role];
  if (stored) return stored;
  const envVar = MODEL_ENV_VARS[role];
  const envValue = envVar ? String(process.env[envVar] || "").trim() : "";
  if (envValue) return envValue;
  return MODEL_DEFAULTS[role] ?? null;
}

export function agentKey(agent) {
  return agent ?? "default";
}
