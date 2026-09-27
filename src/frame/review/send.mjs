import { offers } from "#shared/offers.mjs";
import { places, scroller } from "#frame/app/places.mjs";
import {
  draftedWords,
  markItemsSent,
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
  current,
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
export function canAccept() {
  return (
    Boolean(plan.offer) &&
    connected &&
    current() &&
    !submittedCurrent() &&
    ["ready", "updated"].includes(remote.stage)
  );
}
function feedbackText(extraNotes = []) {
  return [
    `Feedback: ${plan.title}`,
    `Round ${plan.round} of ${plan.name}`,
    "Feedback only. No implementation approval.",
    `Everything else looks good: ${state.alignUnflagged ? "yes" : "no"}.`,
    ...itemLines(extraNotes),
  ].join("\n");
}
// Every unsent item as the agent reads it, each after a blank line.
function itemLines(extraNotes = []) {
  const { notes: unsent, choices, answers } = unsentItems(state);
  const notes = [...unsent, ...extraNotes];
  const lines = [];
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
  return lines;
}
function envelope(intent, text, extra = {}) {
  return {
    sessionId: session.sessionId,
    id: uuid(),
    name: plan.name,
    round: plan.round,
    intent,
    groups: {},
    text,
    ...extra,
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
// Sends Current's draft, with the overall comment typed in the Finish review
// dialog when there is one, and leaves Current waiting on Agreed for the next
// round. From the header, Agreed shows the send while it is in flight and
// a failure returns the reader to where they were. From the dialog, the
// dialog stays open and shows the failure itself.
async function sendFeedback({ comment = null, fromDialog = false } = {}) {
  if (remote?.openRound || !feedbackEditable()) return;
  const extra = comment ? [comment] : [];
  if (
    unsentItems(state).count + extra.length === 0 &&
    (plan.offer || !state.alignUnflagged)
  )
    return;
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
    groups.notes.push(...extra);
    const snapshot = JSON.stringify(groups);
    if (state.pending?.snapshot !== snapshot)
      state.pending = {
        snapshot,
        event: envelope("feedback-only", feedbackText(extra), { groups }),
      };
    persist();
    if (!fromDialog) switchTab("current");
    const result = await send(state.pending.event);
    state.notes.push(...extra);
    state.requestComment = "";
    delete state.requestCommentId;
    markSent(state, result.id, new Date().toISOString());
    submissionInFlight = false;
    setSubmittedRound(plan.round);
    setPastRound(plan.round);
    if (fromDialog) switchTab("current");
    save();
    void loadSubmission().catch(() => {});
  } catch (error) {
    submissionInFlight = false;
    if (fromDialog) {
      review();
      throw error;
    }
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
/* Finish review: on a round with an offer the reader accepts it or requests
   changes, and whatever they drafted goes with either decision. */
const commentsDrafted = () => {
  const { notes, answers } = unsentItems(state);
  return notes.length + Object.keys(answers).length > 0;
};
function openFinish() {
  if (!canAccept()) return;
  renderFinish(document, plan, offers, acceptOffer);
  const words = draftedWords(state);
  if (words) {
    const link = document.createElement("a");
    link.href = "#feedback";
    link.textContent = "Review it";
    link.onclick = (event) => {
      event.preventDefault();
      $("finish-dialog").close();
      show("feedback");
    };
    const goes = unsentItems(state).count === 1 ? "goes" : "go";
    $("finish-drafted").replaceChildren(
      `Your ${words} ${goes} with either decision. `,
      link,
    );
  } else $("finish-drafted").textContent = "Nothing drafted.";
  $("accept-guidance").value = state.acceptGuidance || "";
  $("request-comment").value = state.requestComment || "";
  $("request-comment-label").textContent = commentsDrafted()
    ? "Overall comment, optional"
    : "Overall comment";
  $("request-comment").setAttribute(
    "aria-required",
    String(!commentsDrafted()),
  );
  finishError("");
  chooseDecision("accept");
  $("finish-dialog").showModal();
}
function chooseDecision(value) {
  for (const row of document.querySelectorAll("[data-decision]")) {
    const on = row.dataset.decision === value;
    row.classList.toggle("current", on);
    row.setAttribute("aria-checked", String(on));
    row.tabIndex = on ? 0 : -1;
    row.querySelector(".tick").textContent = on ? "●" : "○";
  }
  $("finish-accept").inert = value !== "accept";
  $("finish-changes").inert = value !== "changes";
  finishError("");
  requestable();
}
// Request changes needs a comment, drafted before or typed here.
function requestable() {
  $("request-changes").disabled =
    !commentsDrafted() && !$("request-comment").value.trim();
}
function finishError(message) {
  $("finish-error").hidden = !message;
  $("finish-error").textContent = message;
}
function finishBusy(busy) {
  for (const button of document.querySelectorAll(
    "#accept-actions button, [data-decision]",
  ))
    button.disabled = busy;
  if (busy) $("request-changes").disabled = true;
  else requestable();
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
    if (plan.offer) openFinish();
    else void sendFeedback();
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
      envelope("feedback-only", feedbackText(), { groups });
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
  for (const row of document.querySelectorAll("[data-decision]")) {
    row.onclick = () => chooseDecision(row.dataset.decision);
    row.onkeydown = (event) => {
      if (!/^Arrow(Up|Down|Left|Right)$/.test(event.key)) return;
      event.preventDefault();
      const next = row.dataset.decision === "accept" ? "changes" : "accept";
      chooseDecision(next);
      document.querySelector(`[data-decision="${next}"]`).focus();
    };
  }
  $("accept-guidance").oninput = (event) => {
    state.acceptGuidance = event.target.value;
    persist();
  };
  $("request-comment").oninput = (event) => {
    state.requestComment = event.target.value;
    persist();
    requestable();
  };
  $("request-changes").onclick = async () => {
    const text = $("request-comment").value.trim();
    // The id is kept until the send succeeds, so a retry sends the same note.
    if (text) state.requestCommentId ||= uuid();
    const comment = text
      ? {
          topic: "overall",
          anchor: "Overall feedback",
          quote: "",
          id: state.requestCommentId,
          text,
          round: plan.round,
        }
      : null;
    finishError("");
    finishBusy(true);
    try {
      await sendFeedback({ comment, fromDialog: true });
      $("finish-dialog").close();
    } catch (error) {
      finishError(unreachable(error));
    } finally {
      finishBusy(false);
    }
  };
}
async function acceptOffer(action) {
  const guidance =
    action.id === offers[plan.offer].accept.guidance.action
      ? $("accept-guidance").value.trim()
      : "";
  const groups = submissionGroups(state);
  const items = itemLines();
  const text = `Accept round ${plan.round} of ${plan.name}: ${action.label}.${guidance ? `\n\nGuidance:\n${guidance}` : ""}${items.length ? `\n\nComments:\n${items.join("\n")}` : ""}`;
  if (
    state.acceptance?.action !== action.id ||
    (state.acceptance?.guidance || "") !== guidance ||
    JSON.stringify(state.acceptance?.groups) !== JSON.stringify(groups)
  )
    state.acceptance = envelope("accept", text, {
      offer: plan.offer,
      action: action.id,
      groups,
      ...(guidance ? { guidance } : {}),
    });
  persist();
  finishError("");
  finishBusy(true);
  try {
    await send(state.acceptance);
    markItemsSent(state, state.acceptance.id);
    save();
    $("finish-dialog").close();
  } catch (error) {
    finishError(unreachable(error));
  } finally {
    finishBusy(false);
  }
}
// Finish your review on a round with an offer. The round's entry in the
// registry fills the Accept row, the hint under Request changes, and the
// Accept section: its note, the guidance field's label and hint, and one
// button per action, plain ones on the left and the primary one on the right.
export function renderFinish(document, round, registry, accept) {
  const $ = (id) => document.getElementById(id);
  const offer = registry[round.offer];
  const text = {
    "finish-detail": `${round.title}, round ${round.round}`,
    "accept-label": offer.accept.label,
    "accept-hint": offer.accept.hint,
    "changes-hint": offer.changes,
    "accept-note": offer.accept.note,
    "accept-guidance-label": offer.accept.guidance.label,
    "accept-guidance-detail": offer.accept.guidance.hint,
  };
  for (const [id, value] of Object.entries(text)) $(id).textContent = value;
  $("accept-actions").replaceChildren(
    ...offer.accept.actions.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.primary ? "btn primary" : "btn";
      button.textContent = action.label;
      button.onclick = () => accept(action);
      return button;
    }),
  );
}
