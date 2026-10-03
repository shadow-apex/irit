/**
 * electron/main/notify-iris.mjs
 *
 * Voice/text "Iris says X" announcements sent down to the Gemini Live
 * session and the renderer. Used by nearly every other domain module, so
 * this file must stay free of heavier dependencies to avoid import cycles.
 */
import { liveSession } from "./gemini-live.mjs";
import { AGENT_LABELS, agentKey } from "./agent-roster.mjs";

export const pendingClaudeAnnouncements = [];

export const MAX_PENDING_ANNOUNCEMENTS = 20;

export function notifyIris(lines, { bufferIfOffline = true } = {}) {
  const text = Array.isArray(lines) ? lines.join("\n") : lines;
  if (liveSession) {
    liveSession.sendRealtimeInput({ text });
  } else if (bufferIfOffline) {
    pendingClaudeAnnouncements.push(text);
    while (pendingClaudeAnnouncements.length > MAX_PENDING_ANNOUNCEMENTS) {
      pendingClaudeAnnouncements.shift();
    }
  }
}

// Switching to a pipeline role is the start of a conversation, not a silent
// config change: Iris must open it — a fresh PO gets the pm-guide question
// ("how did this project start?"), a returning role gets a where-were-we.
export function announceAgentSelection(workstream) {
  const role = workstream.active_agent;
  if (!role) return; // back to plain Iris — no ceremony needed
  const existing = workstream.agent_sessions?.[agentKey(role)] || null;
  const lines = [
    "SYSTEM_EVENT_AGENT_SELECT",
    `role: ${AGENT_LABELS[role] ?? role}`,
    `project: ${workstream.cwd || "the default workspace"}`,
    `existing_claude_conversation: ${existing ?? "none — the next task creates one"}`,
    "instructions_to_iris:",
  ];
  if (role === "po") {
    if (existing) {
      lines.push(
        "- Proactively speak: you are in Product Owner mode and the PO's ongoing Claude conversation is preserved — nothing needs re-explaining.",
        "- Ask ONE short question: continue where you left off (pending decisions, the next feature), or start something new?",
      );
    } else {
      lines.push(
        "- Proactively speak: you are now in Product Owner mode for this project.",
        "- Ask ONE short question: what do they want to build or change?",
        "- After they answer, follow PRODUCT OWNER CONTROL from your instructions: send the PO a SHORT control intent that forwards the request and tells it to grill. Do NOT interview them yourself or write a PRD — the PO grills and asks you questions back by voice.",
      );
    }
  } else if (role === "dev") {
    lines.push(
      existing
        ? "- Proactively speak: you are in Developer mode; the DEV's ongoing Claude conversation is preserved."
        : "- Proactively speak: you are in Developer mode; the next task implements the open OpenSpec change the PO proposed.",
      "- Tell DEV to implement the remaining tasks of the open change (or name a specific change if the user did). If the PO has not proposed a change yet, say so — DEV needs one first.",
    );
  } else if (role === "study") {
    if (existing) {
      lines.push(
        "- Proactively speak: you are in Study mode; the study librarian's ongoing session is preserved.",
        "- Ask ONE short question: continue the current study sitting, or start on a new source?",
      );
    } else {
      lines.push(
        "- Proactively speak: you are now in Study mode — you are the note-taking assistant for their second brain.",
        "- Invite them: open a source and read it, synthesize it out loud, then tell you to save a note or to verify it. You capture and dispatch; the study worker records and fact-checks.",
      );
    }
  }
  lines.push("- Speak in the user's language. Keep it short and conversational — one or two sentences plus the question.");
  notifyIris(lines);
}
