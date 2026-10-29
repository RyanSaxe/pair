import { ago, since } from "#frame/app/time.mjs";
import { $, copyText, installPanel, plural } from "#frame/app/util.mjs";
import { mode, online, session } from "#frame/app/view.mjs";
import {
  installCenter,
  isClearedChange,
  loadCleared,
  renderCenter,
} from "#frame/sync/center.mjs";
import { announced, createReviewAlerts } from "#frame/sync/notifications.mjs";
import {
  countUnopened,
  isOpenedChange,
  openedPages,
  syncOpened,
} from "#frame/sync/opened.mjs";
import { connected, remote } from "#frame/sync/rounds.mjs";
import { syncSeen } from "#frame/sync/seen.mjs";

let sessions = [];
let grouped = [];
export let sessionOrder = [];
export let numbered = [];
let reviewAlerts;
export function installSessions() {
  reviewAlerts = createReviewAlerts({
    window,
    button: $("notifications"),
    sessionId: session.sessionId,
    open: (href) => location.assign(new URL(href, location.href).href),
  });
  installCenter();
  installPanel($("sessions-pop"), $("menu-button"));
  // pair:opened fires when this tab or another tab on the hub opens a page
  // or shows a waiting round.
  window.addEventListener("pair:opened", renderSessions);
  window.addEventListener("pair:cleared", renderSessions);
  window.addEventListener("storage", (event) => {
    if (isOpenedChange(event) || isClearedChange(event)) renderSessions();
  });
}
export function status() {
  $("connection-status").textContent = !online
    ? "Local viewing. Feedback can be exported; live submission requires the session URL."
    : !connected
      ? "The hub is unreachable. Your draft stays here and submits when it is back."
      : "";
  // When another tab closes the session, this tab reloads as a read-only
  // page, so it cannot send anything to an agent that the hub will never
  // wake again.
  if (remote?.dismissedAt && mode === "live") location.reload();
}
// byStart sorts sessions by start time, so a number key opens the same
// session from every tab until a session closes.
export const byStart = (list) =>
  [...list].sort(
    (a, b) =>
      (a.startedAt || "").localeCompare(b.startedAt || "") ||
      a.id.localeCompare(b.id),
  );
/* The hub lists a closed session only while a session linked to it is
   open, and the frame shows the closed session's row as the heading of
   those sessions. */
export function groupSessions(list) {
  const ids = new Set(list.map((entry) => entry.id));
  const children = new Map();
  const roots = [];
  for (const entry of byStart(list))
    if (entry.parentId && ids.has(entry.parentId))
      children.set(entry.parentId, [
        ...(children.get(entry.parentId) || []),
        entry,
      ]);
    else roots.push(entry);
  const rows = [];
  const visit = (entry, depth) => {
    rows.push({ entry, depth });
    for (const child of children.get(entry.id) || []) visit(child, depth + 1);
  };
  for (const entry of roots) visit(entry, 0);
  return rows;
}
export async function pollSessions() {
  let fromHub = false;
  let listed = [];
  // seen contains the hub's lists of cleared lines, opened pages and seen
  // cards. An older hub sends none of them.
  let seen = {};
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) throw Error();
    const body = await response.json();
    listed = body.sessions || [];
    seen = body.seen || {};
    fromHub = true;
  } catch {
    listed = [];
  }
  sessions = listed.filter((entry) => !entry.closed);
  grouped = groupSessions(listed);
  const open = grouped.filter(({ entry }) => !entry.closed);
  sessionOrder = open.map(({ entry }) => entry);
  numbered = open.filter(({ depth }) => !depth).map(({ entry }) => entry);
  if (fromHub) {
    syncOpened(sessions, seen.opened);
    syncSeen(sessions, seen.cards);
  }
  renderSessions();
  renderCenter(listed, fromHub, seen.cleared);
  void reviewAlerts.update(sessions);
}
export function stateWords(entry) {
  if (entry.needsYou) return "Waiting for you";
  if (entry.wakeFailed) return "Could not wake the agent";
  if (entry.paused) return "Paused";
  if (!entry.round) return "Preparing the first round";
  if (entry.openRound)
    return `Working · ${entry.openRound.ready} pages readable`;
  if (["submitted", "working"].includes(entry.stage))
    return `Working · ${since(entry.updatedAt)}`;
  return "Live";
}
export function rowStatus(entry, unopened = 0) {
  if (entry.needsYou) return { text: "Waiting", tone: "need" };
  if (entry.wakeFailed) return { text: "Can't wake", tone: "need" };
  if (unopened) return { text: `${unopened} new`, tone: "news" };
  if (entry.paused) return { text: "Paused", tone: "quiet" };
  if (
    !entry.round ||
    entry.openRound ||
    ["submitted", "working"].includes(entry.stage)
  )
    return { text: "Working", tone: "working" };
  return null;
}
/* A waiting round counts only while the bell still lists its line, and
   renderCenter clears that line once a visible tab has shown the session.
   A round that the reviewer opened therefore stops counting until its
   agent publishes again. cleared is the bell's set of cleared event IDs. */
export function sessionsBadge(list, thisId, unopened, cleared) {
  const others = list.filter((entry) => entry.id !== thisId);
  const waits = (entry) =>
    entry.wakeFailed ||
    (entry.events || []).some(
      (event) =>
        event.kind === "waiting" &&
        announced(entry, event) &&
        !cleared?.has(event.id),
    );
  const unseen = others.filter((entry) => waits(entry) || unopened(entry));
  if (!unseen.length) return { count: others.length, tone: "" };
  return {
    count: unseen.length,
    tone: unseen.some(waits) ? "need" : "news",
  };
}
export function nextWaiting(order, thisId) {
  const at = order.findIndex((entry) => entry.id === thisId);
  return [...order.slice(at + 1), ...order.slice(0, at + 1)].find(
    (entry) => entry.needsYou && entry.id !== thisId,
  );
}
const copyIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
// lineButton puts the tooltip inside the button, so hover and focus show it
// and the pointer can rest on it.
export function lineButton(key, label, content, onclick, tip = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn";
  button.dataset.key = key;
  button.setAttribute("aria-label", label);
  button.innerHTML = content;
  if (tip) {
    const text = document.createElement("span");
    text.className = "line-tip";
    text.setAttribute("aria-hidden", "true");
    text.textContent = tip;
    button.append(text);
  }
  button.onclick = () => onclick(button);
  return button;
}
/* Each icon button has a fixed column, and an empty slot keeps a later
   button in its column. */
export function sessionLine({ key, title, state, words, tint, open, icons }) {
  const line = document.createElement("div");
  line.className = `session-line ${tint}`.trim();
  const row = document.createElement("button");
  row.type = "button";
  row.className = `session-row ${tint}`.trim();
  row.dataset.key = key;
  const name = document.createElement("span");
  name.className = "title";
  name.textContent = title;
  const line2 = document.createElement("span");
  line2.className = "words";
  if (state) {
    const em = document.createElement("em");
    em.textContent = state;
    line2.append(em);
  }
  line2.append(words);
  row.append(name, line2);
  row.onclick = open;
  line.append(row);
  for (const icon of icons) line.append(icon || document.createElement("span"));
  return line;
}
/* redraw replaces a list only when its HTML changed, and it keeps focus on
   the same row or button, so Tab and Enter work in a list that the poll
   refreshes every few seconds. When the focused button is gone, such as a
   cleared event's, focus moves to the element at the same place. */
export function redraw(list, lines) {
  const next = document.createElement("div");
  next.append(...lines);
  if (next.innerHTML === list.innerHTML) return;
  const keyed = () => [...list.querySelectorAll("[data-key]")];
  const focused = keyed().indexOf(document.activeElement);
  const key = document.activeElement?.dataset.key;
  list.replaceChildren(...next.childNodes);
  if (focused < 0) return;
  const now = keyed();
  (
    now.find((element) => element.dataset.key === key) ||
    now.at(focused) ||
    now.at(-1)
  )?.focus();
}
// closing contains the status text of each closing session's row, until the
// hub drops the session or refuses to close it.
const closing = new Map();
function rowTitle(entry, depth) {
  const title = document.createElement("span");
  title.className = "t";
  if (depth) {
    const arrow = document.createElement("span");
    arrow.className = "sub";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↳";
    title.append(arrow);
  }
  title.append(entry.title);
  return title;
}
function sessionRow(entry, unopened, depth) {
  const current = entry.id === session.sessionId;
  const line = document.createElement("div");
  line.className = `sess-line${current ? " current" : ""}`;
  if (depth) line.style.setProperty("--depth", depth);
  if (closing.get(entry.id) === "Closing…") line.dataset.closing = "true";
  const row = document.createElement("button");
  row.type = "button";
  row.className = "sess-row";
  row.dataset.key = `open:${entry.id}`;
  row.title = [
    current ? "This tab" : stateWords(entry),
    entry.round && `round ${entry.round}`,
    ago(entry.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
  const number = document.createElement("span");
  number.className = "n";
  if (!depth) number.textContent = numbered.indexOf(entry) + 1;
  row.append(number, rowTitle(entry, depth));
  const shown = closing.has(entry.id)
    ? { text: closing.get(entry.id), tone: "quiet" }
    : current
      ? null
      : rowStatus(entry, unopened);
  if (shown?.tone === "working") {
    const dot = document.createElement("span");
    dot.className = "working";
    dot.setAttribute("aria-label", "Working");
    row.append(dot);
  } else if (shown) {
    const pill = document.createElement("span");
    pill.className = `pill ${shown.tone}`;
    pill.textContent = shown.text;
    row.append(pill);
  }
  row.onclick = () => {
    if (current) toggleSessions(false);
    else location.assign(entry.url);
  };
  const copy = lineButton(
    `copy:${entry.id}`,
    `Copy handoff line for ${entry.title}`,
    copyIcon,
    async (button) => {
      const tip = button.querySelector(".line-tip");
      tip.textContent = (await copyText(entry.handoff))
        ? "Copied"
        : "Copy failed";
      button.classList.add("tipped");
      setTimeout(() => {
        button.classList.remove("tipped");
        tip.textContent = "Copy handoff line";
      }, 1500);
    },
    "Copy handoff line",
  );
  line.append(
    row,
    copy,
    lineButton(`close:${entry.id}`, `Close ${entry.title}`, "✕", () =>
      confirmClose(entry),
    ),
  );
  return line;
}
const closedIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
function closedHeading(entry, depth) {
  const line = document.createElement("div");
  line.className = "sess-line sess-closed";
  if (depth) line.style.setProperty("--depth", depth);
  const row = document.createElement("div");
  row.className = "sess-row";
  const mark = document.createElement("span");
  mark.className = "n";
  mark.innerHTML = closedIcon;
  const state = document.createElement("span");
  state.className = "pill quiet";
  state.textContent = "Closed";
  row.append(mark, rowTitle(entry, depth), state);
  line.append(row);
  return line;
}
function renderSessions() {
  const waiting = sessionOrder.filter(
    (entry) => entry.needsYou && entry.id !== session.sessionId,
  ).length;
  $("sessions-waiting").textContent = waiting ? `${waiting} waiting` : "";
  const opened = openedPages();
  const unopened = (entry) => countUnopened(entry, opened);
  redraw(
    $("sessions-list"),
    grouped.map(({ entry, depth }) =>
      entry.closed
        ? closedHeading(entry, depth)
        : sessionRow(entry, unopened(entry), depth),
    ),
  );
  const menu = $("menu-button");
  const { count, tone } = sessionsBadge(
    sessionOrder,
    session.sessionId,
    unopened,
    loadCleared(),
  );
  menu.classList.toggle("need", tone === "need");
  menu.classList.toggle("news", tone === "news");
  $("sessions-count").hidden = !count;
  $("sessions-count").textContent = String(count);
  // With no hub, sessionOrder is empty and the button has nothing to open,
  // so the frame hides the button.
  menu.hidden = !sessionOrder.length;
  if (!sessionOrder.length) toggleSessions(false);
  menu.setAttribute(
    "aria-label",
    !count
      ? "Sessions"
      : tone
        ? `Sessions, ${count} ${count === 1 ? "needs" : "need"} you`
        : `Sessions, ${plural(count, "other session")}`,
  );
}
const isOpen = () => $("sessions-pop").matches(":popover-open");
/* With focus set, as when a key opens the list, toggleSessions moves focus
   to this tab's row, so Tab and Enter work through the list. */
export function toggleSessions(open = !isOpen(), focus = false) {
  if (!open) {
    if (isOpen()) $("sessions-pop").hidePopover();
    return;
  }
  if (!sessionOrder.length) return;
  if (!isOpen()) $("sessions-pop").showPopover();
  if (focus)
    $("sessions-list")
      .querySelector(`[data-key="open:${session.sessionId}"]`)
      ?.focus();
}
function confirmClose(entry) {
  $("close-name").textContent = entry.title;
  $("close-confirm").onclick = () => {
    $("close-dialog").close();
    void closeSession(entry);
  };
  $("close-dialog").showModal();
}
/* Closing takes two round trips, a close and a poll, so closeSession shows
   Closing… on the row before either starts. Without it, a slow hub makes
   the control look broken. This tab's own session reloads as a read-only
   page. */
async function closeSession(entry) {
  closing.set(entry.id, "Closing…");
  renderSessions();
  try {
    const response = await fetch(`${entry.url}api/dismiss`, {
      method: "POST",
    });
    if (!response.ok) throw Error();
    if (entry.id === session.sessionId) return location.reload();
    await pollSessions();
  } catch {
    closing.set(entry.id, "Could not close");
    renderSessions();
    setTimeout(() => {
      closing.delete(entry.id);
      renderSessions();
    }, 3000);
    return;
  }
  closing.delete(entry.id);
}
