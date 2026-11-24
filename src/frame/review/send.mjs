import { callHook } from "#frame/app/hooks.mjs";
import { places } from "#frame/app/places.mjs";
import {
  clearSubmissionError,
  connected,
  progressThread,
  refusedMessage,
  selectedTab,
  setRefusedMessage,
  setRemote,
  setSubmissionError,
  setSubmissionInFlight,
} from "#frame/app/state.mjs";
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
import { startThread } from "#frame/notes/threads.mjs";
import { itemSummary, review } from "#frame/review/review.mjs";
import {
  choiceLabel,
  nothingToSend,
  startingChoice,
} from "#frame/review/send-choices.mjs";
import { openSend } from "#frame/review/send-popup.mjs";
import { onCurrent } from "#frame/review/send-state.mjs";

export {
  clearSubmissionError,
  refusedMessage,
  submissionError,
  submissionInFlight,
} from "#frame/app/state.mjs";
export { submitButton } from "#frame/review/send-choices.mjs";

// When another tab or device sends this round while the Send popup is open,
// settleSend calls closeSentSend, which closes the popup and shows the banner
// of the hub's refusal, so the typed message can still go as a message.
export function closeSentSend() {
  $("send-dialog").close();
  setSubmissionError(
    `Round ${plan.round} was sent from another tab or device. Your draft and message stay for the next round.`,
  );
  setRefusedMessage(state.message?.trim() || "");
}

function appendNoteLines(lines, notes) {
  for (const note of notes) {
    const { label, text } = itemSummary("note", note, {
      label: pages.find((item) => item.id === note.topic)?.title || "Overall",
    });
    const attachmentLines = [];
    for (const item of note.attachments || []) {
      attachmentLines.push(`Image: ${item.path}`);
      if (item.scene) attachmentLines.push(`Sketch scene: ${item.scene.path}`);
    }
    lines.push(
      "",
      label,
      ...(note.quote ? ["Selected passage: " + note.quote] : []),
      text,
      /* The hub stores each image in the session directory, so the text
         gives the file's path instead of the image. */
      ...attachmentLines,
    );
  }
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
  appendNoteLines(lines, notes);
  return lines.join("\n");
}

// submission reuses state.pending while the draft, the choice and the
// message are unchanged, so a retry after a failed send sends the same ID
// again. A change to any of them makes a new submission with a new ID.
function submission(next) {
  const groups = submissionGroups(state);
  const message = state.message?.trim() || "";
  const snapshot = JSON.stringify([groups, next, message]);
  if (state.pending?.snapshot !== snapshot) {
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
  }
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
  if (!response.ok) {
    throw Object.assign(Error(result.error), { roundSent: result.roundSent });
  }
  if (result.status.sessionId !== session.sessionId) {
    throw Error("Session identity mismatch.");
  }
  setRemote(result.status);
  return result;
}

export async function sendFeedback(next) {
  if (!onCurrent("send")) return;
  if (nothingToSend(state, next, isPlanRound())) return;
  clearSubmissionError();
  const origin = shownPage();
  setSubmissionInFlight(true);
  review();
  try {
    await Promise.all(
      pages
        .filter((item) => item.id !== "agreed" && item.pending)
        .map((item) => callHook("loadPageRecord", plan.round, item.id)),
    );
    initializeChecklists();
    const event = submission(next);
    persist();
    callHook("switchTab", "current");
    const result = await send(event);
    markSent(state, result.id, new Date().toISOString());
    setSubmissionInFlight(false);
    setSubmittedRound(plan.round);
    setPastRound(plan.round);
    save();
    void callHook("loadSubmission").catch(() => {});
  } catch (error) {
    setSubmissionInFlight(false);
    // A status poll during the send can already have recorded this send as
    // saved. A poll that shows another browser's send does not record it, so
    // the reviewer still sees why the hub refused this one.
    setSubmissionError(
      state.submitted?.round === plan.round
        ? ""
        : unreachable(
            error,
            "Could not reach the hub. Your draft is saved here. Try Send again.",
          ),
    );
    setRefusedMessage(error.roundSent ? state.pending.event.message || "" : "");
    callHook("switchTab", "current", null, { showPage: false });
    callHook("show", origin);
    review();
  }
}

// sendAsMessage starts the thread that Message the agent starts, so the agent
// gets the refused message now and the round's submission stays as it is. Once
// the hub has the thread, the message leaves the draft, so it does not go again
// with the next round. Until then the draft keeps it, in case the hub never
// receives the thread.
function sendAsMessage() {
  const text = refusedMessage;
  clearSubmissionError();
  if (selectedTab !== "current") {
    callHook("switchTab", "current", null, { showPage: false });
  }
  callHook("show", "agreed");
  startThread(progressThread, text, {
    saved: () => {
      if (selectedTab !== "current" || state.message?.trim() !== text) return;
      state.message = "";
      persist();
    },
  });
}

export function installSend() {
  $("submit").addEventListener("click", () => {
    if (selectedTab === "past") {
      // When Current's round is already sent, the handler opens that
      // round's What you sent.
      if (!currentAvailable()) {
        places[submittedRound] = { page: "feedback", at: {} };
        void callHook("openPast", submittedRound);
        return;
      }
      callHook("switchTab", "current");
    }
    openSend();
  });
  $("save-error-message").addEventListener("click", sendAsMessage);
  $("save-error-dismiss").addEventListener("click", () => {
    clearSubmissionError();
    review();
  });
  // The reviewer picks what comes next only in the Send popup, so an export
  // uses the popup's starting choice.
  $("export").addEventListener("click", () => {
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
  });
}
