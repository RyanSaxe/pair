import { openDrawer } from "#frame/app/drawer.mjs";
import { callHook } from "#frame/app/hooks.mjs";
import { persist, state } from "#frame/app/store.mjs";
import { arrowKeys, checkRow } from "#frame/app/ui.mjs";
import { $, plural, shiftEnter } from "#frame/app/util.mjs";
import { isPlanRound, pages, plan } from "#frame/app/view.mjs";
import { notAddedAnswers, typedOn } from "#frame/notes/controls.mjs";
import { yieldNote } from "#frame/notes/note-dialog.mjs";
import {
  choicesFor,
  nothingToSend,
  startingChoice,
} from "#frame/review/send-choices.mjs";
import { onCurrent, sendAccepts } from "#frame/review/send-state.mjs";

export {
  choiceLabel,
  nothingToSend,
  startingChoice,
} from "#frame/review/send-choices.mjs";

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
  row.addEventListener("click", () => select(value));
  return row;
}

function select(value) {
  next = value;
  checkRow(rows(), chosenRow());
  refreshSend();
}

// The drawer's Send is on only while the header's is, so it turns off while
// the hub is unreachable and back on when a poll answers.
export function refreshSend() {
  $("send-label").textContent = next === "build" ? "Build it" : "Send";
  $("send-button").disabled =
    !sendAccepts("send") || nothingToSend(state, next, planRound);
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
      link.addEventListener("click", (event) => {
        event.preventDefault();
        $("send-dialog").close();
        callHook("show", topic, target);
      });
      item.append(link);
      return item;
    }),
  );
}

export function openSend() {
  if (!onCurrent("send") || !yieldNote()) return;
  planRound = isPlanRound();
  $("send-choices").replaceChildren(...choicesFor(planRound).map(choiceRow));
  $("align-unflagged").checked = state.alignUnflagged;
  $("send-message").value = state.message || "";
  select(startingChoice(planRound));
  showNotAdded();
  openDrawer($("send-dialog"), { home: $("submit") });
  // The frame loads a page only when the reviewer opens it. After a reload,
  // openSend loads each pending page that has typed text, so showNotAdded
  // can check its answers.
  const loads = pages
    .filter((item) => item.pending && typedOn(item.id))
    .map((item) =>
      callHook("loadPageRecord", plan.round, item.id).catch(() => {}),
    );
  if (loads.length) {
    void Promise.all(loads).then(() => {
      if ($("send-dialog").open) showNotAdded();
    });
  }
}

function send() {
  if ($("send-button").disabled) return;
  $("send-dialog").close();
  void callHook("sendFeedback", next);
}

export function installSendPopup() {
  arrowKeys($("send-choices"), {
    rows,
    chosen: chosenRow,
    choose: (row) => select(row.dataset.next),
  });
  // The switch and the message are part of the draft, so persist() keeps
  // them until the round is sent, as it keeps the comments.
  $("align-unflagged").addEventListener("change", (event) => {
    state.alignUnflagged = event.target.checked;
    persist();
    refreshSend();
  });
  $("send-message").addEventListener("input", (event) => {
    state.message = event.target.value;
    persist();
    refreshSend();
  });
  $("send-button").addEventListener("click", send);
  $("send-dialog").addEventListener("keydown", (event) => {
    if (!shiftEnter(event)) return;
    event.preventDefault();
    send();
  });
}
