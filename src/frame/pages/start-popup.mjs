import { $, copyText, shiftEnter, unreachable } from "#frame/app/util.mjs";
import { base } from "#frame/app/view.mjs";
import { remote } from "#frame/sync/rounds.mjs";

let card = null;
let where = "here";
let after = null;
const rows = () => [...$("start-dialog").querySelectorAll("[data-where]")];

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
const command = () =>
  `pair start --from ${remote.sessionDir} --proposal ${card.id}`;
export function openStart(proposal, joined, then) {
  card = proposal;
  after = then;
  $("start-title").textContent = card.title;
  $("start-delivers").textContent = card.delivers;
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
  $("start-plan-first").checked = false;
  select(card.recommend || "here");
  $("start-message").value = "";
  $("start-error").hidden = true;
  for (const id of ["start-send", "start-copy", "start-open"])
    $(id).disabled = false;
  $("start-copy").textContent = "Copy command";
  $("start-dialog").showModal();
}
async function post(action, button) {
  button.disabled = true;
  $("start-error").hidden = true;
  try {
    const response = await fetch(
      `${base}/api/proposals/${encodeURIComponent(card.id)}/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          where,
          message: $("start-message").value,
          ...($("start-plan-first").checked ? { planFirst: true } : {}),
        }),
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
// copy() copies the command before it posts, because the browser allows a
// copy only while the click's user activation lasts. It starts the card with
// a new agent only once. The popup stays open, so Open a new agent session
// is still available.
async function copy() {
  const copied = await copyText(command());
  if (!card.started) {
    const result = await post("start", $("start-copy"));
    if (!result) return;
    card = result.proposals.find((item) => item.id === card.id) || card;
    // The card now runs with a new agent, so the frame disables every other
    // choice.
    for (const row of rows()) row.disabled = row.dataset.where !== "new-agent";
    after(result);
  }
  $("start-copy").textContent = copied ? "Copied" : "Copy failed";
}
export function installStart() {
  for (const row of rows()) row.onclick = () => select(row.dataset.where);
  arrowKeys(
    $("start-dialog").querySelector("[role=radiogroup]"),
    rows,
    () => rows().find((row) => row.dataset.where === where),
    (row) => select(row.dataset.where),
  );
  $("start-send").onclick = () => send("start", $("start-send"));
  $("start-copy").onclick = copy;
  $("start-open").onclick = () => send("open-agent", $("start-open"));
  $("start-message").addEventListener("keydown", (event) => {
    if (!shiftEnter(event)) return;
    event.preventDefault();
    const main = $(where === "new-agent" ? "start-open" : "start-send");
    if (!main.disabled) main.click();
  });
}
