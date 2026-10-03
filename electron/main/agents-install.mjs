/**
 * electron/main/agents-install.mjs
 *
 * Installing the bundled Iris agent personas + notes skills into a target
 * project, scaffolding openspec/ for new projects, and small helpers for
 * describing installed agents / recent openspec changes.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";
import { emitEvent } from "./events.mjs";
import { AGENT_ROSTER, AGENT_PREFIX, AGENT_LABELS, RETIRED_AGENTS, resolveAgentModel } from "./agent-roster.mjs";
import { findWorkstream, sessionStore } from "./session-store.mjs";
import { claudeWorkdir, hasOpenSpec, openspecBinary } from "./claude-cli.mjs";

export function runProjectDir(run) {
  const projectDir = findWorkstream(run.workstream_id)?.cwd;
  if (projectDir && fs.existsSync(projectDir)) return projectDir;
  return claudeWorkdir();
}

export function globalAgentsDir() {
  return path.join(os.homedir(), ".claude", "agents");
}

// Roles install globally (~/.claude/agents) so they work in any project, but a
// project-local .claude/agents copy wins if the user customized one there.
export function installedAgentFile(agent, cwd) {
  const name = `${AGENT_PREFIX}${agent}.md`;
  const candidates = [
    cwd ? path.join(cwd, ".claude", "agents", name) : null,
    path.join(globalAgentsDir(), name),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

export function personasSourceDir() {
  const candidates = [
    path.join(repoRoot, "resources", "personas"),
    process.resourcesPath ? path.join(process.resourcesPath, "personas") : null,
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

// Ported from myiris: the second-brain capability's vendored wiki-*
// skill bundle (resources/skills/claude-skills/wiki-*), same dev/packaged
// dual-location pattern as personasSourceDir() above.
export function skillsSourceDir() {
  const candidates = [
    path.join(repoRoot, "resources", "skills"),
    process.resourcesPath ? path.join(process.resourcesPath, "skills") : null,
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

// Installs the second brain's 6 vendored wiki-* skills into ~/.claude/skills
// (mirrors installIrisAgents' sync-on-every-install-click behavior, but for
// whole skill directories rather than single .md files).
export function installNotesSkills() {
  const sourceRoot = skillsSourceDir();
  if (!sourceRoot) {
    return { status: "error", error: "Notes-skill templates were not found in the app bundle.", installed: [], skipped: [], errors: [] };
  }
  const sourceDir = path.join(sourceRoot, "claude-skills");
  const targetRoot = path.join(os.homedir(), ".claude", "skills");
  const installed = [];
  const skipped = [];
  const errors = [];
  const NOTES_SKILLS = ["wiki-config", "wiki-ingest", "wiki-query", "wiki-lint", "wiki-integrate", "wiki-crystallize"];
  try {
    fs.mkdirSync(targetRoot, { recursive: true });
  } catch (error) {
    return { status: "error", error: `Could not create ${targetRoot}: ${error.message}`, installed, skipped, errors };
  }
  for (const name of NOTES_SKILLS) {
    const source = path.join(sourceDir, name);
    const target = path.join(targetRoot, name);
    try {
      if (!fs.existsSync(source)) {
        errors.push(`${name}: template missing from the app bundle`);
        continue;
      }
      if (fs.existsSync(target)) {
        skipped.push(name);
        continue;
      }
      fs.cpSync(source, target, { recursive: true });
      installed.push(name);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  emitEvent({
    type: "log",
    level: errors.length ? "warn" : "info",
    message: `Notes skills: ${installed.length} installed, ${skipped.length} already present in ${targetRoot}${errors.length ? ` — errors: ${errors.join("; ")}` : ""}.`,
  });
  return { status: errors.length ? "partial" : "ok", installed, skipped, errors };
}

// --- Ported from myiris: canvas (hud-drawing-canvas) + second brain
// (personal-knowledge-notes / second-brain-galaxy-view) capabilities.
// Instantiated once at module scope, same lifecycle as canvasStore/etc. —
// their IPC handlers are registered inside app.whenReady() below, and
// ensureCanvasMcpForRun() is called from startDevRun() before every
// plain-Claude spawn.

export function installIrisAgents() {
  const sourceDir = personasSourceDir();
  if (!sourceDir) {
    return { status: "error", error: "Persona templates were not found in the app bundle.", installed: [], skipped: [], errors: [] };
  }
  const targetDir = globalAgentsDir();
  const installed = [];
  const skipped = [];
  const removed = [];
  const errors = [];
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (error) {
    return { status: "error", error: `Could not create ${targetDir}: ${error.message}`, installed, skipped, errors };
  }
  for (const agent of AGENT_ROSTER) {
    const name = `${AGENT_PREFIX}${agent}.md`;
    try {
      const source = path.join(sourceDir, name);
      const target = path.join(targetDir, name);
      if (!fs.existsSync(source)) {
        errors.push(`${name}: template missing from the app bundle`);
        continue;
      }
      // "Install agents" is an explicit user action: always sync the installed
      // copy to the bundled template so prompt updates actually land.
      const content = fs.readFileSync(source, "utf8");
      if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) {
        skipped.push(name);
        continue;
      }
      fs.writeFileSync(target, content);
      installed.push(name);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  for (const agent of RETIRED_AGENTS) {
    const name = `${AGENT_PREFIX}${agent}.md`;
    try {
      const target = path.join(targetDir, name);
      if (fs.existsSync(target)) {
        fs.rmSync(target);
        removed.push(name);
      }
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  emitEvent({
    type: "log",
    level: errors.length ? "warn" : "info",
    message: `Iris agents: ${installed.length} installed/updated, ${skipped.length} already current, ${removed.length} retired removed in ${targetDir}${errors.length ? ` — errors: ${errors.join("; ")}` : ""}.`,
  });
  return { status: errors.length ? "partial" : "ok", installed, skipped, removed, errors };
}

// OpenSpec is the pipeline's only SDD surface (see the po-voice-controller
// change). A fresh project `cwd` is made OpenSpec-ready with `openspec init`
// instead of the old hand-written `.scratch/` + CONTEXT.md + docs/agents seeding.
// The PO agent then produces changes under `openspec/changes/`, and archiving
// syncs deltas into `openspec/specs/`. No-op if `openspec/` already exists so an
// existing OpenSpec setup is never disturbed.
export function ensureProjectScaffold(cwd) {
  if (hasOpenSpec(cwd)) return { created: [] };
  try {
    // `openspec init` is interactive by default; `--tools claude` runs it
    // non-interactively and writes the Claude slash-commands (verified against
    // openspec 1.6.0). Point it at `cwd` explicitly rather than relying on the
    // child's own cwd.
    execFileSync(openspecBinary(), ["init", cwd, "--tools", "claude"], {
      stdio: "ignore",
      timeout: 60000,
    });
    return { created: hasOpenSpec(cwd) ? ["openspec/"] : [] };
  } catch (error) {
    return { created: [], error: `openspec init failed: ${error.message}` };
  }
}

export function agentDescription(filePath) {
  try {
    const head = fs.readFileSync(filePath, "utf8").slice(0, 2000);
    const match = /^description:\s*(.+)$/m.exec(head);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

// The most recently modified active (non-archived) OpenSpec change in `cwd`, or
// null. This is the "current feature" the pipeline UI reports gates for.
export function latestOpenChange(cwd) {
  try {
    const changesDir = path.join(cwd, "openspec", "changes");
    let best = null;
    let bestTime = -1;
    for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive" || entry.name.startsWith(".")) continue;
      const mtime = fs.statSync(path.join(changesDir, entry.name)).mtimeMs;
      if (mtime > bestTime) {
        bestTime = mtime;
        best = entry.name;
      }
    }
    return best;
  } catch {
    return null;
  }
}

// Snapshot for the pipeline UI: which roles are installed, and — for the
// workstream's project folder — which gates have been passed for the current
// OpenSpec change. PO gate = a proposal exists (the change was proposed); DEV
// gate = every task in tasks.md is checked (implementation complete).
export function agentsSnapshot(workstreamId) {
  const workstream = findWorkstream(workstreamId) || findWorkstream(sessionStore.active);
  const cwd = workstream?.cwd && fs.existsSync(workstream.cwd) ? workstream.cwd : null;
  const roster = AGENT_ROSTER.map((agent) => {
    const file = installedAgentFile(agent, cwd);
    return {
      key: agent,
      label: AGENT_LABELS[agent],
      installed: Boolean(file),
      description: file ? agentDescription(file) : "",
      model: resolveAgentModel(workstream, agent),
    };
  });
  const gates = { slug: null, byRole: {} };
  if (cwd) {
    gates.slug = latestOpenChange(cwd);
    if (gates.slug) {
      const changeDir = path.join(cwd, "openspec", "changes", gates.slug);
      gates.byRole.po = fs.existsSync(path.join(changeDir, "proposal.md"));
      // DEV gate passes when tasks.md exists and has no unchecked `- [ ]` left.
      let devDone = false;
      try {
        const tasks = fs.readFileSync(path.join(changeDir, "tasks.md"), "utf8");
        devDone = !/^\s*-\s*\[\s\]/m.test(tasks);
      } catch { devDone = false; }
      gates.byRole.dev = devDone;
    }
  }
  return {
    roster,
    installed: roster.every((entry) => entry.installed),
    hasProject: Boolean(cwd),
    gates,
  };
}
