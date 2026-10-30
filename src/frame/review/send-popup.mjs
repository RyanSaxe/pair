import { persist, state, unsentItems } from "#frame/app/store.mjs";
import { $, plural, shiftEnter } from "#frame/app/util.mjs";
import {
  feedbackEditable,
  isPlanRound,
  pages,
  plan,
} from "#frame/app/view.mjs";
import { notAddedAnswers, typedOn } from "#frame/notes/controls.mjs";
import { show } from "#frame/pages/pages.mjs";
import { arrowKeys, checkRow } from "#frame/pages/start-popup.mjs";
import { sendFeedback } from "#frame/review/send.mjs";
import { loadPageRecord, remote } from "#frame/sync/rounds.mjs";

/* openSend selects the first choice of each list, and Build it is always
   last, so the popup never opens with Build it selected. */
const choices = {
  round: [
    {
      next: "iterate",
      label: "Keep iterating",
      hint: "This session's agent takes your comments into the next pages.",
    },
    {
      next: "plan",
      label: "Write a plan",
      hint: "This session's agent writes a plan you can build from.",
    },
    {
      next: "build",
      label: "Build it",
      hint: "This session's agent builds what Agreed says.",
    },
  ],
  plan: [
    {
      next: "plan",
      label: "Update the plan",
      hint: "This session's agent revises the plan with your comments.",
    },
    {
      next: "iterate",
      label: "Back to iterating",
      hint: "This session's agent sets the plan aside and keeps exploring.",
    },
    {
      next: "build",
      label: "Build it",
      hint: "This session's agent builds this plan.",
    },
  ],
};
const choicesFor = (planRound) => choices[planRound ? "plan" : "round"];
export const choiceLabel = (next, planRound) =>
  choicesFor(planRound).find((item) => item.next === next)?.label;
export const startingChoice = (planRound) => choicesFor(planRound)[0].next;
export const nothingToSend = (draft, next, planRound) =>
  unsentItems(draft).count === 0 &&
  !draft.alignUnflagged &&
  !draft.message?.trim() &&
  next === startingChoice(planRound);

let next = "iterate";
let planRound = false;
const rows = () => [...$("send-choices").querySelectorAll("[data-next]")];
const chosenRow = () => rows().find((row) => row.dataset.next === next);

function choiceRow({ next: value, label, hint }) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "dialog-row";
  row.setAttribute("role", "radio");
  row.dataset.next = value;
  const tick = document.createElement("span");
  tick.className = "tick";
  tick.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  const name = document.createElement("span");
  name.className = "start-choice";
  name.textContent = label;
  const line = document.createElement("small");
  line.textContent = hint;
  text.append(name, line);
  row.append(tick, text);
  row.onclick = () => select(value);
  return row;
}
function select(value) {
  next = value;
  checkRow(rows(), chosenRow());
  refresh();
}
function refresh() {
  $("send-label").textContent = next === "build" ? "Build it" : "Send";
  $("send-button").disabled = nothingToSend(state, next, planRound);
}
function showNotAdded() {
  const found = notAddedAnswers();
  $("send-not-added").hidden = !found.length;
  $("send-not-added-count").textContent =
    `${plural(found.length, "typed answer")} ${found.length === 1 ? "is" : "are"} not added`;
  $("send-not-added-list").replaceChildren(
    ...found.map(({ topic, target, label }) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `?target=${encodeURIComponent(target)}#${encodeURIComponent(topic)}`;
      link.textContent = label;
      link.onclick = (event) => {
        event.preventDefault();
        $("send-dialog").close();
        show(topic, target);
      };
      item.append(link);
      return item;
    }),
  );
}
export function openSend() {
  if (remote?.openRound || !feedbackEditable()) return;
  planRound = isPlanRound();
  $("send-choices").replaceChildren(...choicesFor(planRound).map(choiceRow));
  $("align-unflagged").checked = state.alignUnflagged;
  $("send-message").value = state.message || "";
  select(startingChoice(planRound));
  showNotAdded();
  $("send-dialog").showModal();
  // The frame loads a page only when the reviewer opens it. After a reload,
  // openSend loads each pending page that has typed text, so showNotAdded
  // can check its answers.
  const loads = pages
    .filter((item) => item.pending && typedOn(item.id))
    .map((item) => loadPageRecord(plan.round, item.id).catch(() => {}));
  if (loads.length)
    void Promise.all(loads).then(() => {
      if ($("send-dialog").open) showNotAdded();
    });
}
function send() {
  if ($("send-button").disabled) return;
  $("send-dialog").close();
  void sendFeedback(next);
}
export function installSendPopup() {
  arrowKeys($("send-choices"), rows, chosenRow, (row) =>
    select(row.dataset.next),
  );
  // The switch and the message are part of the draft, so persist() keeps
  // them until the round is sent, as it keeps the comments.
  $("align-unflagged").onchange = (event) => {
    state.alignUnflagged = event.target.checked;
    persist();
    refresh();
  };
  $("send-message").oninput = (event) => {
    state.message = event.target.value;
    persist();
    refresh();
  };
  $("send-button").onclick = send;
  $("send-dialog").addEventListener("keydown", (event) => {
    if (!shiftEnter(event)) return;
    event.preventDefault();
    send();
  });
}
