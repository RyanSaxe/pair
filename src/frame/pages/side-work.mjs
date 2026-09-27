import { state } from "#frame/app/store.mjs";
import { $, plural, unreachable } from "#frame/app/util.mjs";
import { base, editable } from "#frame/app/view.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import { tag } from "#frame/pages/agreed.mjs";
import { remote } from "#frame/sync/rounds.mjs";

/* Side work: what turned up during the session outside its task. The hub
   keeps each item, so Agreed shows the session's list after the decisions,
   whichever round is on screen, and each status poll brings its changes. */
const labels = {
  started: ["Started", ""],
  working: ["Working", ""],
  pr: ["Pull request", ""],
  done: ["Done", "ok"],
  dropped: ["Dropped", "muted"],
};
const finished = (item) => ["done", "dropped"].includes(item.state);
// A Start or Drop the hub refused, shown on its item until the item's state
// changes.
const failures = new Map();
let rendered = "";
let finishedOpen = false;

// A GitHub pull request reads as owner/repo#N.
function linkText(url) {
  const pull = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return pull ? `${pull[1]}#${pull[2]}` : url;
}
function button(text, action, onclick, tone = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `btn ${tone}`.trim();
  element.dataset.action = action;
  element.textContent = text;
  element.onclick = () => onclick(element);
  return element;
}
async function send(item, action, element) {
  element.disabled = true;
  try {
    const response = await fetch(
      `${base}/api/side-work/${encodeURIComponent(item.id)}/${action}`,
      { method: "POST" },
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The hub refused.");
    failures.delete(item.id);
    remote.sideWork = result.sideWork;
  } catch (error) {
    failures.set(item.id, { state: item.state, text: unreachable(error) });
  }
  refreshSideWork(true);
}
function actions(item, card) {
  const row = document.createElement("div");
  row.className = "side-work-actions";
  const left = document.createElement("span");
  left.append(
    button("Comment", "comment", () =>
      openNote(
        "agreed",
        `Side work: ${item.title}`,
        "",
        null,
        null,
        card.id,
        item.id,
      ),
    ),
  );
  if (!finished(item))
    left.append(
      button("Drop", "drop", (element) => send(item, "drop", element)),
    );
  row.append(left);
  // Start in parallel sits alone on the right, away from Drop.
  if (item.state === "recorded")
    row.append(
      button(
        "Start in parallel",
        "start",
        (element) => send(item, "start", element),
        "primary",
      ),
    );
  return row;
}
function itemCard(item) {
  const card = document.createElement("section");
  card.className = "side-work-item";
  card.id = `side-work-${item.id}`;
  const title = document.createElement("h2");
  title.textContent = item.title;
  if (labels[item.state]) title.append(tag(...labels[item.state]));
  const notes = state.notes.filter((note) => note.sideWorkId === item.id);
  if (notes.length) title.append(tag(plural(notes.length, "note"), "muted"));
  const text = document.createElement("p");
  text.textContent = item.text;
  // The frame sizes every p on a page, so the smaller lines are divs.
  const source = document.createElement("div");
  source.className = "side-work-source";
  source.textContent = item.source;
  if (item.url) {
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = linkText(item.url);
    source.append(
      " · ",
      link,
      item.state === "pr" ? ", open" : item.state === "done" ? ", merged" : "",
    );
  }
  card.append(title, text, source);
  const failure = failures.get(item.id);
  const problem =
    (failure?.state === item.state && failure.text) ||
    (item.state === "recorded" && item.wake?.ok === false
      ? "Could not reach the agent to start this. Try again."
      : "");
  if (problem) {
    const line = document.createElement("div");
    line.className = "side-work-error";
    line.setAttribute("role", "alert");
    line.textContent = problem;
    card.append(line);
  }
  if (editable) card.append(actions(item, card));
  return card;
}
// Open items in the order the agent added them, then Finished, folded.
export function sideWorkSection() {
  const items = remote?.sideWork || [];
  rendered = JSON.stringify(items);
  const section = document.createElement("div");
  section.id = "side-work";
  section.hidden = !items.length;
  if (!items.length) return section;
  const label = document.createElement("p");
  label.className = "agreed-label";
  label.textContent = "Side work";
  section.append(
    label,
    ...items.filter((item) => !finished(item)).map(itemCard),
  );
  const done = items.filter(finished);
  if (done.length) {
    const fold = document.createElement("details");
    fold.className = "side-work-finished";
    fold.open = finishedOpen;
    fold.ontoggle = () => (finishedOpen = fold.open);
    const summary = document.createElement("summary");
    summary.textContent = `Finished (${done.length})`;
    fold.append(summary, ...done.map(itemCard));
    section.append(fold);
  }
  return section;
}
// Replaces the list on Agreed when the hub's items changed, and keeps the
// focused button where it was.
export function refreshSideWork(force = false) {
  const section = $("side-work");
  if (
    !section ||
    (!force && JSON.stringify(remote?.sideWork || []) === rendered)
  )
    return;
  const focused = section.contains(document.activeElement)
    ? document.activeElement
    : null;
  const card = focused?.closest(".side-work-item")?.id;
  const action = focused?.dataset.action;
  section.replaceWith(sideWorkSection());
  if (card)
    $(card)
      ?.querySelector(`[data-action="${action}"]`)
      ?.focus({ preventScroll: true });
}
