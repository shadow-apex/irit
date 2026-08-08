/**
 * electron/main/claude-cli.mjs
 *
 * Locating the Claude / openspec CLI binaries, and the "is the pipeline
 * usable right now" health checks used throughout the app.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { poBillingStatus } from "../po-session.mjs";
import { emitEvent } from "./events.mjs";

export let claudePipelineAvailable = true;
export function getPipelineAvailable() {
  return claudePipelineAvailable;
}

export function claudeBinary() {
  if (process.env.IRIS_CLAUDE_BIN) return process.env.IRIS_CLAUDE_BIN;
  // A packaged .app does not inherit the shell PATH, so probe common installs.
  const known = [
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const candidate of known) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "claude.cmd" : "claude";
}

// Same PATH-probe rationale as claudeBinary(): a packaged .app does not inherit
// the shell PATH, and the OpenSpec CLI (the SDD engine the pipeline runs on) is
// typically installed under ~/.local/bin. Override with IRIS_OPENSPEC_BIN.
export function openspecBinary() {
  if (process.env.IRIS_OPENSPEC_BIN) return process.env.IRIS_OPENSPEC_BIN;
  const known = [
    path.join(os.homedir(), ".local", "bin", "openspec"),
    "/usr/local/bin/openspec",
    "/opt/homebrew/bin/openspec",
  ];
  for (const candidate of known) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "openspec";
}

// A `cwd` is OpenSpec-ready once it has an `openspec/` directory (created by
// `openspec init`). The pipeline uses OpenSpec as its only SDD surface.
export function hasOpenSpec(cwd) {
  try {
    return fs.statSync(path.join(cwd, "openspec")).isDirectory();
  } catch {
    return false;
  }
}

// Names of active (non-archived) OpenSpec changes in `cwd` whose tasks.md still
// has at least one unchecked `- [ ]` task. DEV runs are gated on this being
// non-empty (see startClaudeRun): no open change with work → no DEV run.
export function openChangesWithTasks(cwd) {
  const out = [];
  try {
    const changesDir = path.join(cwd, "openspec", "changes");
    for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive" || entry.name.startsWith(".")) continue;
      const tasksMd = path.join(changesDir, entry.name, "tasks.md");
      try {
        if (/^\s*-\s*\[\s\]/m.test(fs.readFileSync(tasksMd, "utf8"))) out.push(entry.name);
      } catch { /* no tasks.md yet — not an implementable change */ }
    }
  } catch { /* no openspec/changes — none */ }
  return out;
}

export function claudeWorkdir() {
  const dir = process.env.IRIS_CLAUDE_CWD || path.join(os.homedir(), ".iris", "workspace");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function checkClaudeStatus() {
  return new Promise((resolve) => {
    execFile(claudeBinary(), ["--version"], { timeout: 15000 }, (error, stdout) => {
      if (error) {
        claudePipelineAvailable = false;
        emitEvent({ type: "claude_status", status: "error", error: error.message });
        resolve({ reachable: false, error: error.message });
      } else {
        claudePipelineAvailable = true;
        const health = { version: String(stdout).trim(), binary: claudeBinary() };
        emitEvent({ type: "claude_status", status: "ready", detail: health });
        resolve({ reachable: true, health });
      }
    });
  });
}

// Combined status for the SetupPanel's Claude section (design.md D3b/D3c):
// CLI reachability (same probe as checkClaudeStatus) plus the PO subscription
// billing-path status, read-only — never editable from the UI.
export async function checkClaudeHealth() {
  const status = await checkClaudeStatus();
  const billing = poBillingStatus();
  return {
    reachable: status.reachable,
    version: status.health?.version,
    error: status.error,
    billingOk: billing.ok,
    billingError: billing.ok
      ? undefined
      : "No CLAUDE_CODE_OAUTH_TOKEN set — PO turns will fail until you run `claude setup-token`.",
  };
}

// ===== Onboarding / Settings (design.md D3/D4) =====

export function logPoBillingPathOnce() {
  const billing = poBillingStatus();
  if (billing.ok) {
    console.log("[IRIS][po-auth] PO session will bill against the Claude subscription (CLAUDE_CODE_OAUTH_TOKEN set).");
  } else {
    console.warn(
      "[IRIS][po-auth] No CLAUDE_CODE_OAUTH_TOKEN found. PO turns will fail until you run `claude setup-token` " +
      "and set CLAUDE_CODE_OAUTH_TOKEN (see .env.example). DEV is unaffected.",
    );
  }
}
