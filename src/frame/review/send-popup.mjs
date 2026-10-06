import { persist, state, unsentItems } from "#frame/app/store.mjs";
import { $, shiftEnter } from "#frame/app/util.mjs";
import { feedbackEditable, isPlanRound } from "#frame/app/view.mjs";
import { arrowKeys, checkRow } from "#frame/pages/start-popup.mjs";
import { sendFeedback } from "#frame/review/send.mjs";
import { remote } from "#frame/sync/rounds.mjs";

/* The popup Send feedback opens: what comes next, the Everything else
   looks good switch, an optional message to the agent, and the button that
   sends the round. A plan round has its own choices. Each popup starts on
   its first choice, and Build it is always last, so it never starts
   selected. Write a plan and Update the plan send "plan", Keep iterating
   and Back to iterating send "iterate", and Build it sends "build". */
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
// The words of a choice, as the popup and Review's sent list show them.
export const choiceLabel = (next, planRound) =>
  choicesFor(planRound).find((item) => item.next === next)?.label;
// The choice the popup starts on.
export const startingChoice = (planRound) => choicesFor(planRound)[0].next;
// Sending sends nothing when there are no comments, the switch is off,
// there is no message, and the choice is the one the popup starts on.
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
// The button names the build when Build it is chosen, and is off only
// when sending would send nothing.
function refresh() {
  $("send-label").textContent = next === "build" ? "Build it" : "Send";
  $("send-button").disabled = nothingToSend(state, next, planRound);
}
export function openSend() {
  if (remote?.openRound || !feedbackEditable()) return;
  planRound = isPlanRound();
  $("send-choices").replaceChildren(...choicesFor(planRound).map(choiceRow));
  $("align-unflagged").checked = state.alignUnflagged;
  $("send-message").value = state.message || "";
  select(startingChoice(planRound));
  $("send-dialog").showModal();
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
  // The switch and the message are part of the draft, so they stay until
  // the round is sent, like the comments.
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
