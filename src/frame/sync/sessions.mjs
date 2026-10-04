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

let sessions = [];
export let sessionOrder = [];
let reviewAlerts;
let narrow;
export function installSessions() {
  reviewAlerts = createReviewAlerts({
    window,
    button: $("notifications"),
    sessionId: session.sessionId,
    open: (href) => location.assign(new URL(href, location.href).href),
  });
  installCenter();
  narrow = matchMedia("(max-width: 720px)");
  narrow.addEventListener("change", () => {
    toggleSessions(false);
    renderSessions();
  });
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
export async function pollSessions() {
  let fromHub = false;
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) throw Error();
    sessions = (await response.json()).sessions || [];
    fromHub = true;
  } catch {
    sessions = [];
  }
  sessionOrder = byStart(sessions);
  if (fromHub) syncOpened(sessions);
  renderSessions();
  renderCenter(sessions, fromHub);
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
/* The sessions button's badge counts every live session. It is orange when
   another session waits for you or its agent could not be woken, otherwise
   blue when another session has pages this browser has not opened, and
   otherwise grey. At 720px and below the same button also opens this tab's
   Pages, so this tab's unopened pages count toward blue there. */
export function sessionsBadge(list, thisId, unopened, narrowScreen) {
  const others = list.filter((entry) => entry.id !== thisId);
  const own = list.find((entry) => entry.id === thisId);
  const tone = others.some((entry) => entry.needsYou || entry.wakeFailed)
    ? "need"
    : others.some((entry) => unopened(entry)) ||
        (narrowScreen && own && unopened(own))
      ? "news"
      : "";
  return { count: list.length, tone };
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
/* One session's row: its number, title and short status, then Copy
   handoff line and Close in two fixed columns. This tab's row has no
   Close. */
function sessionRow(entry, index, unopened) {
  const current = entry.id === session.sessionId;
  const line = document.createElement("div");
  line.className = `sess-line${current ? " current" : ""}`;
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
  number.textContent = index + 1;
  const title = document.createElement("span");
  title.className = "t";
  title.textContent = entry.title;
  row.append(number, title);
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
    current
      ? document.createElement("span")
      : lineButton(`close:${entry.id}`, `Close ${entry.title}`, "✕", () =>
          dismiss(entry),
        ),
  );
  return line;
}
// At 720px and below the sessions button opens the menu sheet, with this
// tab's Pages above the sessions. A home view has no pages, so there the
// button opens the session list at every width.
const opensSheet = () => narrow.matches && mode !== "home";
/* Every session, in sessionOrder, in the popover above 720px and under
   Pages in the menu sheet at 720px and below, and the sessions button's
   badge. */
function renderSessions() {
  const waiting = sessionOrder.filter(
    (entry) => entry.needsYou && entry.id !== session.sessionId,
  ).length;
  for (const id of ["sessions-waiting", "sheet-sessions-waiting"])
    $(id).textContent = waiting ? `${waiting} waiting` : "";
  const opened = openedPages();
  const unopened = (entry) => countUnopened(entry, opened);
  const rows = () =>
    sessionOrder.map((entry, index) =>
      sessionRow(entry, index, unopened(entry)),
    );
  redraw($("sessions-list"), rows());
  redraw($("sheet-sessions"), rows());
  $("sheet-sessions-label").hidden = !sessionOrder.length;
  const menu = $("menu-button");
  const { count, tone } = sessionsBadge(
    sessionOrder,
    session.sessionId,
    unopened,
    opensSheet(),
  );
  menu.classList.toggle("need", tone === "need");
  menu.classList.toggle("news", tone === "news");
  $("sessions-count").hidden = !count;
  $("sessions-count").textContent = String(count);
  // With no hub there is no session to list, so above 720px the button has
  // nothing to open. At 720px and below it still opens Pages.
  menu.hidden = !count && !opensSheet();
  if (!count) toggleSessions(false);
  const what = opensSheet() ? "Pages and sessions" : "Sessions";
  menu.setAttribute(
    "aria-label",
    count
      ? `${what}, ${count} live${waiting ? `, ${plural(waiting, "session")} waiting for you` : ""}`
      : what,
  );
}
// The popover opens under the button, wherever the header puts it.
function placeSessions() {
  const box = $("menu-button").getBoundingClientRect();
  $("sessions-pop").style.top = `${box.bottom + 6}px`;
  $("sessions-pop").style.left = `${box.left}px`;
}
const isOpen = () => $("sessions-pop").matches(":popover-open");
/* Open or close the session list above 720px. Opening it from a key moves
   focus to this tab's row, so Tab and Enter work through the list. */
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
/* Two round trips, a dismiss and a poll, so the row says it is going
   before either starts. Without it a slow hub looks like a dead control. */
async function dismiss(entry) {
  closing.set(entry.id, "Closing…");
  renderSessions();
  try {
    const response = await fetch(`${entry.url}api/dismiss`, {
      method: "POST",
    });
    if (!response.ok) throw Error();
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
