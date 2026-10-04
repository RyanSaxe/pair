import { draftedWords, state, unsentItems } from "#frame/app/store.mjs";
import { $, unreachable } from "#frame/app/util.mjs";
import { base } from "#frame/app/view.mjs";
import { remote } from "#frame/sync/rounds.mjs";

/* The Start popup on a proposal's card: what the card delivers and may
   change, where the work runs and an optional message to the agent. Each
   choice has its own row of buttons, and the rows share one grid cell, so
   the choices, the message box and the button row keep their places
   whichever choice is selected. Only Here starts work in this release. */

const enabled = new Set(["here"]);
let card = null;
let where = "here";
let after = null;
const rows = () => $("start-dialog").querySelectorAll("[data-where]");

function select(choice) {
  where = choice;
  for (const row of rows()) {
    const chosen = row.dataset.where === choice;
    row.setAttribute("aria-checked", String(chosen));
    row.classList.toggle("current", chosen);
    row.tabIndex = chosen ? 0 : -1;
  }
  for (const section of $("start-dialog").querySelectorAll(
    "[data-start-actions]",
  ))
    section.inert = section.dataset.startActions !== choice;
}
// Start answers a round that waits for the reviewer, as Send feedback does,
// so the hint says when that leaves drafted feedback unsent.
function hint() {
  const unsent = unsentItems(state).count;
  return remote?.needsYou && unsent
    ? `Sent to the agent with Start. Start ends round ${remote.current.round}, so your ${draftedWords(state)} on it stay unsent. Send your feedback first to include them.`
    : "Sent to the agent with Start.";
}
export function openStart(proposal, then) {
  card = proposal;
  after = then;
  $("start-title").textContent = card.title;
  $("start-delivers").textContent = card.delivers;
  $("start-changes").textContent = card.changes;
  for (const row of rows()) {
    row.disabled = !enabled.has(row.dataset.where);
    row.querySelector(".start-recommended").hidden =
      row.dataset.where !== card.recommend;
  }
  select(enabled.has(card.recommend) ? card.recommend : "here");
  $("start-message").value = "";
  $("start-hint").textContent = hint();
  $("start-error").hidden = true;
  $("start-send").disabled = false;
  $("start-dialog").showModal();
}
async function send() {
  $("start-send").disabled = true;
  $("start-error").hidden = true;
  try {
    const response = await fetch(
      `${base}/api/proposals/${encodeURIComponent(card.id)}/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ where, message: $("start-message").value }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The hub refused it.");
    $("start-dialog").close();
    after(result);
  } catch (error) {
    $("start-error").textContent = unreachable(error);
    $("start-error").hidden = false;
    $("start-send").disabled = false;
  }
}
export function installStart() {
  for (const row of rows()) row.onclick = () => select(row.dataset.where);
  // The arrow keys move between the choices that can start work, as in a
  // radio group.
  $("start-dialog")
    .querySelector("[role=radiogroup]")
    .addEventListener("keydown", (event) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
        event.key
      ];
      if (!step) return;
      event.preventDefault();
      const open = [...rows()].filter((row) => !row.disabled);
      const index = open.findIndex((row) => row.dataset.where === where);
      const next = open[(index + step + open.length) % open.length];
      select(next.dataset.where);
      next.focus();
    });
  $("start-send").onclick = send;
}
