import { places, scroller } from "#frame/app/places.mjs";
import {
  markSent,
  persist,
  save,
  state,
  submissionGroups,
  unsentItems,
} from "#frame/app/store.mjs";
import { $, hubUnreachable, unreachable, uuid } from "#frame/app/util.mjs";
import {
  base,
  currentAvailable,
  feedbackEditable,
  page,
  pages,
  plan,
  session,
  setPastRound,
  setSubmittedRound,
  submittedCurrent,
  submittedRound,
} from "#frame/app/view.mjs";
import { initializeChecklists } from "#frame/notes/controls.mjs";
import { show } from "#frame/pages/pages.mjs";
import { itemSummary, review } from "#frame/review/review.mjs";
import {
  connected,
  loadPageRecord,
  loadSubmission,
  openPast,
  remote,
  selectedTab,
  setRemote,
  switchTab,
} from "#frame/sync/rounds.mjs";

export let submissionError = "";
export let submissionInFlight = false;
// The header button. It sends feedback, and opens Feedback once Current's
// round is sent. Its count is the drafted items that go with it.
export function submitButton({
  inFlight,
  opensFeedback,
  onSentFeedback,
  waitingForPages,
  sendable,
  pending,
  alignUnflagged,
}) {
  const hasFeedback = pending > 0 || alignUnflagged;
  return {
    disabled:
      inFlight ||
      (opensFeedback
        ? onSentFeedback
        : waitingForPages || !hasFeedback || !sendable),
    text: inFlight
      ? "Sending"
      : opensFeedback
        ? "Feedback"
        : pending
          ? `Send feedback (${pending})`
          : "Send feedback",
    primary: !opensFeedback && !waitingForPages,
  };
}
// The submission's text, which an export carries: every unsent item as the
// agent reads it, each after a blank line.
function feedbackText() {
  const lines = [
    `Feedback: ${plan.title}`,
    `Round ${plan.round} of ${plan.name}`,
    `Everything else looks good: ${state.alignUnflagged ? "yes" : "no"}.`,
  ];
  const { notes, choices, answers } = unsentItems(state);
  // A checklist the reviewer left alone reads like any other. An empty one
  // means none picked.
  const untouched = Object.values(state.choices).filter(
    (choice) => choice.kind === "multiple" && !choice.sentIn && !choice.touched,
  );
  for (const choice of [...Object.values(choices), ...untouched]) {
    const { label, text } = itemSummary("choice", choice);
    lines.push("", `${label}: ${text}`);
  }
  for (const answer of Object.values(answers)) {
    const { label, text } = itemSummary("answer", answer, {
      drawing: (item) =>
        `Drawing scene ${item.sceneId}; PNG preview ${item.previewId}`,
    });
    lines.push("", `${label}`, text);
  }
  for (const note of notes) {
    const { label, text } = itemSummary("note", note, {
      label: pages.find((item) => item.id === note.topic)?.title || "Overall",
    });
    lines.push(
      "",
      label,
      ...(note.quote ? ["Selected passage: " + note.quote] : []),
      text,
      /* The bytes stay in the session directory, so the text names the file
         rather than carrying it. An export the reviewer mails on says the
         same, which is the only way the paths travel with it. */
      ...(note.attachments || []).map((item) => `Image: ${item.path}`),
    );
  }
  return lines.join("\n");
}
function envelope(text, groups) {
  return {
    sessionId: session.sessionId,
    id: uuid(),
    name: plan.name,
    round: plan.round,
    intent: "feedback-only",
    groups,
    text,
  };
}
async function send(event) {
  if (!connected) throw Error(hubUnreachable);
  const response = await fetch(`${base}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  if (result.status.sessionId !== session.sessionId)
    throw Error("Session identity mismatch.");
  setRemote(result.status);
  return result;
}
// Sends Current's draft and leaves Current waiting on Agreed for the next
// round. Agreed shows the send while it is in flight, and a failure returns
// the reader to where they were.
async function sendFeedback() {
  if (remote?.openRound || !feedbackEditable()) return;
  if (unsentItems(state).count === 0 && !state.alignUnflagged) return;
  submissionError = "";
  const origin = {
    page: $("reading").hidden ? "feedback" : page.id,
    top: scroller().scrollTop,
  };
  submissionInFlight = true;
  review();
  try {
    await Promise.all(
      pages
        .filter((item) => item.id !== "agreed" && item.pending)
        .map((item) => loadPageRecord(plan.round, item.id)),
    );
    initializeChecklists();
    const groups = submissionGroups(state);
    const snapshot = JSON.stringify(groups);
    if (state.pending?.snapshot !== snapshot)
      state.pending = { snapshot, event: envelope(feedbackText(), groups) };
    persist();
    switchTab("current");
    const result = await send(state.pending.event);
    markSent(state, result.id, new Date().toISOString());
    submissionInFlight = false;
    setSubmittedRound(plan.round);
    setPastRound(plan.round);
    save();
    void loadSubmission().catch(() => {});
  } catch (error) {
    submissionInFlight = false;
    submissionError = submittedCurrent()
      ? ""
      : unreachable(
          error,
          "Could not reach the hub. Your comments are saved here. Try Send feedback again.",
        );
    switchTab("current", null, { showPage: false });
    show(origin.page);
    scroller().scrollTo(0, origin.top);
    review();
  }
}
export function installSend() {
  $("align-unflagged").onchange = (event) => {
    if (!feedbackEditable()) return;
    state.alignUnflagged = event.target.checked;
    save();
  };
  $("submit").onclick = () => {
    if (selectedTab === "past") {
      // Current's round was already sent, so the button opens its Feedback.
      if (!currentAvailable()) {
        places[submittedRound] = { page: "feedback", top: 0 };
        void openPast(submittedRound);
        return;
      }
      switchTab("current");
    }
    void sendFeedback();
  };
  $("save-error-dismiss").onclick = () => {
    submissionError = "";
    review();
  };
  $("export").onclick = () => {
    const groups = submissionGroups(state);
    const event =
      (state.pending?.snapshot === JSON.stringify(groups) &&
        state.pending.event) ||
      envelope(feedbackText(), groups);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(event, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${plan.name}-${plan.round}-feedback.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
}
