import {
  besideControl,
  openDrawer,
  pressedControl,
} from "#frame/app/drawer.mjs";
import { persist, state } from "#frame/app/store.mjs";
import { $, copyText, shiftEnter, unreachable } from "#frame/app/util.mjs";
import { base } from "#frame/app/view.mjs";
import { yieldNote } from "#frame/notes/note-dialog.mjs";
import { sendKey, sendKeyName } from "#frame/notes/threads.mjs";
import {
  clearItem,
  drawItem,
  fitItem,
  installItem,
  itemFields,
  itemId,
  itemReady,
  lockItem,
} from "#frame/pages/new-item.mjs";
import { remote } from "#frame/sync/rounds.mjs";

// card is null while the dialog writes a new card, until the hub has it.
let card = null;
let where = "here";
let after = null;
// newId keeps the ID that Copy command copied, so the card gets that ID.
let newId = null;
const rows = () => [...$("start-dialog").querySelectorAll("[data-where]")];
const showSave = (shown) => {
  for (const button of $("start-dialog").querySelectorAll("[data-start-save]"))
    button.hidden = !shown;
};

export function checkRow(rows, chosen) {
  for (const row of rows) {
    row.setAttribute("aria-checked", String(row === chosen));
    row.classList.toggle("current", row === chosen);
    row.tabIndex = row === chosen ? 0 : -1;
  }
}
export function arrowKeys(group, rows, chosen, choose) {
  group.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const open = rows().filter((row) => !row.disabled);
    const index = open.indexOf(chosen());
    const next = open[(index + step + open.length) % open.length];
    choose(next);
    next.focus();
  });
}
function select(choice) {
  where = choice;
  checkRow(
    rows(),
    rows().find((row) => row.dataset.where === choice),
  );
  for (const part of $("start-dialog").querySelectorAll("[data-start-for]"))
    part.inert = !part.dataset.startFor.split(" ").includes(choice);
  $("start-message").setAttribute("aria-describedby", `start-hint-${choice}`);
  // A plan round must not mix with this session's other work, so the frame
  // disables Plan it first when Here is chosen.
  const planFirst = $("start-plan-first");
  planFirst.disabled = choice === "here";
  if (planFirst.disabled) planFirst.checked = false;
}
const command = (id) =>
  `pair start --from ${remote.sessionDir} --proposal ${id}`;
function showForm(writing) {
  $("start-write").hidden = !writing;
  $("start-delivers").hidden = writing;
  $("start-message-box").hidden = writing;
  showSave(writing);
}
// openNewItem opens the dialog with the form that writes a new card. Here is
// chosen first, as it is for a card with no recommendation. then receives the
// hub's answer and the new card's ID.
export function openNewItem(then) {
  if (!yieldNote()) return;
  card = null;
  after = then;
  newId = null;
  $("start-title").textContent = "New work item";
  showForm(true);
  drawItem();
  $("start-joined").hidden = true;
  for (const row of rows()) {
    row.disabled = false;
    row.querySelector(".start-recommended").hidden = true;
  }
  resetDialog("here");
  openDrawer($("start-dialog"), besideControl($("work-new")));
  fitItem();
  $("start-write-title").focus();
}
function resetDialog(choice) {
  $("start-plan-first").checked = false;
  select(choice);
  $("start-message").value = (card && state.startMessages[card.id]) || "";
  $("start-error").hidden = true;
  for (const id of ["start-send", "start-copy", "start-open"])
    $(id).disabled = false;
  $("start-copy").textContent = "Copy command";
}
export function openStart(proposal, joined, then) {
  if (!yieldNote()) return;
  card = proposal;
  after = then;
  $("start-title").textContent = card.title;
  $("start-delivers").textContent = card.delivers;
  showForm(false);
  $("start-joined").hidden = !joined.length;
  $("start-joined-list").replaceChildren(
    ...joined.map((item) => {
      const line = document.createElement("li");
      line.textContent = item.title;
      return line;
    }),
  );
  for (const row of rows()) {
    row.disabled = false;
    row.querySelector(".start-recommended").hidden =
      row.dataset.where !== card.recommend;
  }
  resetDialog(card.recommend || "here");
  const button = document.querySelector(
    `[data-proposal-card="${CSS.escape(card.id)}"] .proposal-start`,
  );
  openDrawer($("start-dialog"), besideControl(button || pressedControl()));
  // The dialog may have been open already for another card or form.
  $("start-title").focus();
}
const planFields = () =>
  $("start-plan-first").checked ? { planFirst: true } : {};
// post starts an existing card, or sends a new card with what to do with it.
async function post(action, button) {
  button.disabled = true;
  $("start-error").hidden = true;
  const url = card
    ? `${base}/api/proposals/${encodeURIComponent(card.id)}/${action}`
    : `${base}/api/proposals`;
  const fields = card
    ? { where, message: $("start-message").value, ...planFields() }
    : {
        id: newId ?? writtenId(),
        ...itemFields(),
        action,
        where,
        ...planFields(),
      };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The hub refused it.");
    button.disabled = false;
    newId = fields.id ?? null;
    if (card) {
      delete state.startMessages[card.id];
      persist();
    }
    return result;
  } catch (error) {
    $("start-error").textContent = unreachable(error);
    $("start-error").hidden = false;
    button.disabled = false;
    return null;
  }
}
const writtenId = () =>
  itemId(
    itemFields().title,
    (remote?.proposals || []).map((item) => item.id),
  );
async function send(action, button) {
  if (!card && !itemReady()) return;
  const writing = !card;
  const result = await post(action, button);
  if (!result) return;
  if (writing) clearItem();
  $("start-dialog").close();
  after(result, card?.id ?? newId);
}
// copy() copies the command before it posts, because the browser allows a
// copy only while the click's user activation lasts. It starts the card with
// a new agent only once. The popup stays open, so Open a new agent session
// is still available.
async function copy() {
  if (!card && !itemReady()) return;
  const id = card?.id ?? (newId = writtenId());
  const copied = await copyText(command(id));
  if (!card?.started) {
    const writing = !card;
    const result = await post("start", $("start-copy"));
    if (!result) return;
    card = result.proposals.find((item) => item.id === id) || card;
    // The card now runs with a new agent, so the frame disables every other
    // choice.
    for (const row of rows()) row.disabled = row.dataset.where !== "new-agent";
    if (writing) {
      clearItem();
      lockItem(true);
      showSave(false);
    }
    after(result, id);
  }
  $("start-copy").textContent = copied ? "Copied" : "Copy failed";
}
export function installStart() {
  installItem();
  for (const button of $("start-dialog").querySelectorAll(
    "[data-start-save]",
  )) {
    button.setAttribute("aria-keyshortcuts", sendKeyName());
    button.onclick = () => send("save", button);
  }
  // The form's left button has the key of the note dialog's left button.
  for (const id of ["start-write-title", "start-write-text"])
    $(id).addEventListener("keydown", (event) => {
      if (!sendKey(event)) return;
      event.preventDefault();
      const save = $("start-dialog").querySelector(
        ".actions:not([inert]) [data-start-save]",
      );
      if (!save.hidden && !save.disabled) save.click();
    });
  for (const row of rows()) row.onclick = () => select(row.dataset.where);
  arrowKeys(
    $("start-dialog").querySelector("[role=radiogroup]"),
    rows,
    () => rows().find((row) => row.dataset.where === where),
    (row) => select(row.dataset.where),
  );
  // Start and New work item keep each card's message when another opens here.
  $("start-message").addEventListener("input", (event) => {
    if (!card) return;
    state.startMessages[card.id] = event.target.value;
    persist();
  });
  $("start-send").onclick = () => send("start", $("start-send"));
  $("start-copy").onclick = copy;
  $("start-open").onclick = () => send("open-agent", $("start-open"));
  for (const id of ["start-message", "start-write-title", "start-write-text"])
    $(id).addEventListener("keydown", (event) => {
      if (!shiftEnter(event)) return;
      event.preventDefault();
      const main = $(where === "new-agent" ? "start-open" : "start-send");
      if (!main.disabled) main.click();
    });
}
