import { places } from "#frame/app/places.mjs";
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
  isPlanRound,
  pages,
  plan,
  session,
  setPastRound,
  setSubmittedRound,
  shownPage,
  submittedRound,
} from "#frame/app/view.mjs";
import { initializeChecklists } from "#frame/notes/controls.mjs";
import { show } from "#frame/pages/pages.mjs";
import { itemSummary, review } from "#frame/review/review.mjs";
import {
  choiceLabel,
  nothingToSend,
  openSend,
  startingChoice,
} from "#frame/review/send-popup.mjs";
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
export function submitButton({
  inFlight,
  opensFeedback,
  onSentFeedback,
  waitingForPages,
  sendable,
  pending,
}) {
  return {
    disabled:
      inFlight ||
      (opensFeedback ? onSentFeedback : waitingForPages || !sendable),
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
function feedbackText(next, message) {
  const lines = [
    `Feedback: ${plan.title}`,
    `Round ${plan.round} of ${plan.name}`,
    `Everything else looks good: ${state.alignUnflagged ? "yes" : "no"}.`,
    `Next: ${choiceLabel(next, isPlanRound())}.`,
  ];
  if (message) lines.push("", "Message to the agent", message);
  const { notes, choices, answers } = unsentItems(state);
  // The text includes each checklist that the reviewer never touched, and
  // an empty checklist means that the reviewer picked no item.
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
      /* The hub stores each image in the session directory, so the text
         gives the file's path instead of the image. */
      ...(note.attachments || []).flatMap((item) => [
        `Image: ${item.path}`,
        ...(item.scene ? [`Sketch scene: ${item.scene.path}`] : []),
      ]),
    );
  }
  return lines.join("\n");
}
// submission reuses state.pending while the draft, the choice and the
// message are unchanged, so a retry after a failed send sends the same ID
// again. A change to any of them makes a new submission with a new ID.
function submission(next) {
  const groups = submissionGroups(state);
  const message = state.message?.trim() || "";
  const snapshot = JSON.stringify([groups, next, message]);
  if (state.pending?.snapshot !== snapshot)
    state.pending = {
      snapshot,
      event: {
        sessionId: session.sessionId,
        id: uuid(),
        name: plan.name,
        round: plan.round,
        intent: "feedback-only",
        next,
        ...(message ? { message } : {}),
        groups,
        text: feedbackText(next, message),
      },
    };
  return state.pending.event;
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
export async function sendFeedback(next) {
  if (remote?.openRound || !feedbackEditable()) return;
  if (nothingToSend(state, next, isPlanRound())) return;
  submissionError = "";
  const origin = shownPage();
  submissionInFlight = true;
  review();
  try {
    await Promise.all(
      pages
        .filter((item) => item.id !== "agreed" && item.pending)
        .map((item) => loadPageRecord(plan.round, item.id)),
    );
    initializeChecklists();
    const event = submission(next);
    persist();
    switchTab("current");
    const result = await send(event);
    markSent(state, result.id, new Date().toISOString());
    submissionInFlight = false;
    setSubmittedRound(plan.round);
    setPastRound(plan.round);
    save();
    void loadSubmission().catch(() => {});
  } catch (error) {
    submissionInFlight = false;
    // A status poll during the send can already have recorded this send as
    // saved. A poll that shows another browser's send does not record it, so
    // the reviewer still sees why the hub refused this one.
    submissionError =
      state.submitted?.round === plan.round
        ? ""
        : unreachable(
            error,
            "Could not reach the hub. Your comments are saved here. Try Send feedback again.",
          );
    switchTab("current", null, { showPage: false });
    show(origin);
    review();
  }
}
export function installSend() {
  $("submit").onclick = () => {
    if (selectedTab === "past") {
      // When Current's round is already sent, the handler opens that
      // round's Feedback.
      if (!currentAvailable()) {
        places[submittedRound] = { page: "feedback", at: {} };
        void openPast(submittedRound);
        return;
      }
      switchTab("current");
    }
    openSend();
  };
  $("save-error-dismiss").onclick = () => {
    submissionError = "";
    review();
  };
  // The reviewer picks what comes next only in the Send popup, so an export
  // uses the popup's starting choice.
  $("export").onclick = () => {
    const event = submission(startingChoice(isPlanRound()));
    persist();
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
