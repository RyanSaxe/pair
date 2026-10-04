import { $, copyText, unreachable } from "#frame/app/util.mjs";
import { base } from "#frame/app/view.mjs";
import { remote } from "#frame/sync/rounds.mjs";

/* The Start popup on a proposal's card: what the card delivers, where the
   work runs and an optional message to the agent. Each choice has its own
   hint and its own row of buttons, and the hints share one grid cell and
   the rows another, so the choices, the message box and the button row
   keep their places whichever choice is selected. Here and In a
   sub-session start at once. With a new agent copies the command a new
   agent runs, or asks this session's agent to open one. */

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
  for (const part of $("start-dialog").querySelectorAll("[data-start-for]"))
    part.inert = !part.dataset.startFor.split(" ").includes(choice);
  $("start-message").setAttribute("aria-describedby", `start-hint-${choice}`);
}
// The command a new agent runs to start the card's session.
const command = () =>
  `pair start --from ${remote.sessionDir} --proposal ${card.id}`;
export function openStart(proposal, then) {
  card = proposal;
  after = then;
  $("start-title").textContent = card.title;
  $("start-delivers").textContent = card.delivers;
  for (const row of rows()) {
    row.disabled = false;
    row.querySelector(".start-recommended").hidden =
      row.dataset.where !== card.recommend;
  }
  select(card.recommend || "here");
  $("start-message").value = "";
  $("start-error").hidden = true;
  for (const id of ["start-send", "start-copy", "start-open"])
    $(id).disabled = false;
  $("start-copy").textContent = "Copy command";
  $("start-dialog").showModal();
}
// Sends one of the card's routes with the choice and the message. The
// popup stays open when the hub refuses, with the hub's reason.
async function post(action, button) {
  button.disabled = true;
  $("start-error").hidden = true;
  try {
    const response = await fetch(
      `${base}/api/proposals/${encodeURIComponent(card.id)}/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ where, message: $("start-message").value }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The hub refused it.");
    button.disabled = false;
    return result;
  } catch (error) {
    $("start-error").textContent = unreachable(error);
    $("start-error").hidden = false;
    button.disabled = false;
    return null;
  }
}
async function send(action, button) {
  const result = await post(action, button);
  if (!result) return;
  $("start-dialog").close();
  after(result);
}
// Copy command copies first, while the click still allows it, then starts
// the card with a new agent once. The popup stays open, so Open a new agent
// session is still there.
async function copy() {
  const copied = await copyText(command());
  if (!card.started) {
    const result = await post("start", $("start-copy"));
    if (!result) return;
    card = result.proposals.find((item) => item.id === card.id) || card;
    // The card now runs with a new agent, so only this choice is left.
    for (const row of rows()) row.disabled = row.dataset.where !== "new-agent";
    after(result);
  }
  $("start-copy").textContent = copied ? "Copied" : "Copy failed";
}
export function installStart() {
  for (const row of rows()) row.onclick = () => select(row.dataset.where);
  // The arrow keys move between the choices left, as in a radio group.
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
  $("start-send").onclick = () => send("start", $("start-send"));
  $("start-copy").onclick = copy;
  $("start-open").onclick = () => send("open-agent", $("start-open"));
}
