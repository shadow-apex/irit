/**
 * electron/main/po-questions.mjs
 *
 * The PO "ask the user a clarifying question" flow: pending-question state,
 * voice + context-supplement delivery, and resolving the answer once the
 * user responds (by voice or from the UI).
 */
import { AGENT_LABELS } from "./agent-roster.mjs";
import { notifyIris } from "./notify-iris.mjs";
import { emitEvent } from "./events.mjs";
import { poQuestionTimeoutMs } from "../po-session.mjs";

export const PendingQuestion = {
  current: null, // { workstreamId, questions, resolve, timer }

  raise(workstreamId, questions, { timeoutMs, role = "po" }) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.expire(), timeoutMs);
      this.current = { workstreamId, questions, resolve, timer, role };
      emitPoQuestionEvent(workstreamId, questions, "pending", role);
    });
  },

  settle(status, resolvedValue) {
    if (!this.current) return;
    const { workstreamId, questions, resolve, timer, role } = this.current;
    clearTimeout(timer);
    this.current = null;
    emitPoQuestionEvent(workstreamId, questions, status, role);
    resolve(resolvedValue);
  },

  answer(answers) {
    this.settle("answered", answers);
  },

  expire() {
    if (!this.current) return;
    emitEvent({
      type: "log",
      level: "warn",
      message: `${AGENT_LABELS[this.current.role] ?? "The role"}'s question went unanswered — applying the recommended option for each.`,
    });
    this.settle("timed_out", defaultPoAnswers(this.current.questions));
  },

  abandon(workstreamId) {
    if (!this.current || this.current.workstreamId !== workstreamId) return;
    this.settle("timed_out", defaultPoAnswers(this.current.questions));
  },
};

export function defaultPoAnswers(questions) {
  const answers = {};
  for (const q of questions) {
    answers[q.question] = q.options?.[0]?.label ?? "";
  }
  return answers;
}

// The `role` (po | study) rides along so the UI can attribute the question; the
// event type stays `po_question` for renderer/IPC back-compat.
export function emitPoQuestionEvent(workstreamId, questions, status, role = "po") {
  emitEvent({ type: "po_question", workstream_id: workstreamId, status, questions, role });
}

// canUseTool's onAskUserQuestion callback (electron/po-session.mjs and
// study-session.mjs): pauses the asking role's live turn, relays the question(s)
// to Gemini voice, and resolves once an answer arrives — via the Gemini tool,
// the UI IPC channel, or PendingQuestion's own timeout fallback. Only one run
// executes globally at a time, so at most one question is ever pending and PO
// and STUDY safely share this single relay. See the voice-decision-relay spec.
export function askUserQuestionViaVoice(workstreamId, questions, role = "po") {
  const promise = PendingQuestion.raise(workstreamId, questions, { timeoutMs: poQuestionTimeoutMs(), role });
  const roleLabel = AGENT_LABELS[role] ?? "The active role";

  const lines = [
    "SYSTEM_EVENT_PO_QUESTION",
    `asking_role: ${roleLabel}`,
    "instructions_to_iris:",
    `- The ${roleLabel} has paused to ask you something. Read each question aloud with its options, in order, and collect the user's answer for each.`,
    "- Once you have every answer, call answer_po_question with one entry per question (question text verbatim, and the option label the user chose).",
    "- If asked for your recommendation, suggest the first-listed option, but submit whatever the user actually picks.",
    "questions:",
    ...questions.map(
      (q, i) =>
        `${i + 1}. ${q.question}\n${(q.options || [])
          .map((opt, j) => `   ${j + 1}) ${opt.label} — ${opt.description}`)
          .join("\n")}`,
    ),
  ].join("\n");
  notifyIris(lines);

  return promise;
}

// Text the user typed/pasted instead of saying it aloud (a link, a note) —
// voice can't reliably dictate this. Delivered as one more SYSTEM_EVENT_* so
// Gemini reacts to it exactly like everything else in the live conversation.
// Deliberately never buffered: the composer UI disables itself while asleep,
// so there is nothing worth redelivering on reconnect (design.md decision 6).
export function sendContextSupplement(text) {
  const clean = String(text || "").trim();
  if (!clean) return { status: "error", error: "Empty supplement text." };
  const lines = [
    "SYSTEM_EVENT_CONTEXT_SUPPLEMENT",
    `supplement: ${clean}`,
    "instructions_to_iris:",
    "- The user just typed/pasted this instead of saying it aloud (voice can't reliably convey links or precise text).",
    "- CRITICAL: be decisive — do not ask for confirmation first.",
    "- Immediately call submit_claude_task with a brief that combines the recent conversation with this supplement (e.g. research the linked repo for a feature relevant to what you were just discussing, and report whether/how it applies here).",
    "- Do not set the agent field — let it route to whichever role is already active for this session.",
  ].join("\n");
  notifyIris(lines, { bufferIfOffline: false });
  return { status: "ok" };
}

// FEAT-COMP-CONTROL-01: điều khiển Iris từ điện thoại companion (gõ tay hoặc
// thoại-to-text trên phone.html). KHÔNG dùng chung đường sendContextSupplement
// ở trên — hàm đó ép Iris luôn gọi submit_claude_task (dành riêng cho việc bổ
// sung ngữ cảnh giữa 1 task Claude Code đang chạy), sai hoàn toàn cho các
// lệnh chung như "bật đèn phòng khách" hay 1 câu hỏi bình thường. Ở đây bơm
// thẳng text vào liveSession qua notifyIris — Iris xử lý y hệt như một câu
// nói/gõ bình thường, được dùng đúng bộ công cụ (smarthome, hỏi đáp, v.v.)
// đang có sẵn cho hội thoại thường, không ép route qua agent pipeline.
export function sendPhoneCommand(text) {
  const clean = String(text || "").trim();
  if (!clean) return { status: "error", error: "Empty phone command." };
  const lines = [
    "SYSTEM_EVENT_PHONE_COMMAND",
    `message_from_user_via_phone: ${clean}`,
    "instructions_to_iris:",
    "- The user just sent this from their Companion phone app (typed or spoken-to-text) instead of speaking to you directly — treat it exactly like normal spoken input and respond/act on it now.",
  ].join("\n");
  notifyIris(lines, { bufferIfOffline: false });
  return { status: "ok" };
}

// Voice (Gemini tool) and the UI (IPC) both call this; whichever answers first
// wins — the second call is a no-op since PendingQuestion is already settled.
export function resolvePendingPoQuestion(answers) {
  if (!PendingQuestion.current) return { status: "error", error: "No PO question is pending." };
  const map = {};
  for (const entry of Array.isArray(answers) ? answers : []) {
    if (entry?.question) map[entry.question] = entry.choice ?? "";
  }
  PendingQuestion.answer(map);
  return { status: "ok" };
}
