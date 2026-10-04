import { ago, since } from "#frame/app/time.mjs";
import { $, copyText, plural } from "#frame/app/util.mjs";
import { mode, online, session } from "#frame/app/view.mjs";
import { installCenter, renderCenter } from "#frame/sync/center.mjs";
import { createReviewAlerts } from "#frame/sync/notifications.mjs";
import {
  countUnopened,
  isOpenedChange,
  openedPages,
  syncOpened,
} from "#frame/sync/opened.mjs";
import { connected, remote } from "#frame/sync/rounds.mjs";
import { syncSeen } from "#frame/sync/seen.mjs";

let sessions = [];
// The rows of Sessions, closed parents included, from groupSessions().
let grouped = [];
// Every open session, in list order, for w and the badge.
export let sessionOrder = [];
// The open sessions the 1 to 9 keys reach: every one but a sub-session.
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
  $("sessions-pop").addEventListener("toggle", (event) => {
    $("menu-button").setAttribute(
      "aria-expanded",
      String(event.newState === "open"),
    );
  });
  $("sessions-pop").addEventListener("beforetoggle", (event) => {
    if (event.newState === "open") placeSessions();
  });
  // This tab or another one on the hub opened a page.
  window.addEventListener("pair:opened", renderSessions);
  window.addEventListener("storage", (event) => {
    if (isOpenedChange(event)) renderSessions();
  });
}
export function status() {
  $("connection-status").textContent = !online
    ? "Local viewing. Feedback can be exported; live submission requires the session URL."
    : !connected
      ? "The hub is unreachable. Your draft stays here and submits when it is back."
      : "";
  // A session closed from another tab reloads into read-only, so this tab
  // cannot send anything to an agent that will never be woken again.
  if (remote?.dismissedAt && mode === "live") location.reload();
}
// Sessions in the order they started, so a number opens the same session
// from every tab until one closes.
export const byStart = (list) =>
  [...list].sort(
    (a, b) =>
      (a.startedAt || "").localeCompare(b.startedAt || "") ||
      a.id.localeCompare(b.id),
  );
/* Sessions in the order they started, each sub-session right after the
   session it came from, one step deeper. The hub lists a closed session
   only while a session linked to it is open, and its row is the heading of
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
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) throw Error();
    listed = (await response.json()).sessions || [];
    fromHub = true;
  } catch {
    listed = [];
  }
  sessions = listed.filter((entry) => !entry.closed);
  grouped = groupSessions(listed);
  // A number opens the same open session from every tab.
  const open = grouped.filter(({ entry }) => !entry.closed);
  sessionOrder = open.map(({ entry }) => entry);
  numbered = open.filter(({ depth }) => !depth).map(({ entry }) => entry);
  if (fromHub) {
    syncOpened(sessions);
    syncSeen(sessions);
  }
  renderSessions();
  renderCenter(listed, fromHub);
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
/* A row's one short status, the first that applies: a round waiting for
   you, a failed wake, pages this browser has not opened, paused, then the
   agent at work, which a session before its first round always is. */
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
/* The sessions button's badge counts the other sessions that need you: a
   round waiting for you or an agent that could not be woken, which turns
   it orange, or pages this browser has not opened, which turn it blue
   when nothing waits. When no other session needs you, it counts the
   other live sessions in grey. This tab's session never counts. */
export function sessionsBadge(list, thisId, unopened) {
  const others = list.filter((entry) => entry.id !== thisId);
  const waits = (entry) => entry.needsYou || entry.wakeFailed;
  const needing = others.filter((entry) => waits(entry) || unopened(entry));
  if (!needing.length) return { count: others.length, tone: "" };
  return {
    count: needing.length,
    tone: needing.some(waits) ? "need" : "news",
  };
}
// The next session after this one, in list order and wrapping to the top,
// whose round waits for you.
export function nextWaiting(order, thisId) {
  const at = order.findIndex((entry) => entry.id === thisId);
  return [...order.slice(at + 1), ...order.slice(0, at + 1)].find(
    (entry) => entry.needsYou && entry.id !== thisId,
  );
}
const copyIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
// An icon button on a line. Its tooltip is part of the button, so hover and
// focus show it and the pointer can rest on it.
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
/* One line of the bell's list: a row with a title and a words line, then
   its icon buttons, each in a fixed column. An empty slot keeps a later
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
/* A poll redraws a list only when what it shows changed, and keeps focus on
   the same row or button, so Tab and Enter work through a list that
   refreshes every few seconds. When that button is gone, as a cleared
   event's is, focus stays at its place in the list. */
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
// A closing session's row says so until the hub drops it or refuses.
const closing = new Map();
// A row's name, after an arrow when the session is a sub-session.
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
/* One session's row: its number, or none for a sub-session, its title and
   short status, then Copy handoff line and Close in two fixed columns. */
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
// A closed session over its open sub-sessions: its name in grey, a lock in
// the number column, no buttons, and Closed at the right end of the row.
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
/* Every session, in sessionOrder, in the popover, and the sessions
   button's badge. */
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
  );
  menu.classList.toggle("need", tone === "need");
  menu.classList.toggle("news", tone === "news");
  $("sessions-count").hidden = !count;
  $("sessions-count").textContent = String(count);
  // With no hub there is no session to list, so the button has nothing to
  // open.
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
// The popover opens under the button, inside the window.
function placeSessions() {
  const box = $("menu-button").getBoundingClientRect();
  const width = Math.min(340, innerWidth - 16);
  $("sessions-pop").style.top = `${box.bottom + 6}px`;
  $("sessions-pop").style.left =
    `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
}
const isOpen = () => $("sessions-pop").matches(":popover-open");
/* Open or close the session list. Opening it from a key moves focus to
   this tab's row, so Tab and Enter work through the list. */
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
// Close asks first, in a dialog that says what closing does.
function confirmClose(entry) {
  $("close-name").textContent = entry.title;
  $("close-confirm").onclick = () => {
    $("close-dialog").close();
    void closeSession(entry);
  };
  $("close-dialog").showModal();
}
/* Two round trips, a close and a poll, so the row says it is going before
   either starts. Without it a slow hub looks like a dead control. This
   tab's own session reloads read-only. */
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
