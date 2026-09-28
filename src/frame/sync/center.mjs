import { ago } from "#frame/app/time.mjs";
import { $, plural } from "#frame/app/util.mjs";
import { page, pages, plan, session } from "#frame/app/view.mjs";
import { show } from "#frame/pages/pages.mjs";
import { eventHref, eventTitle } from "#frame/sync/notifications.mjs";
import {
  lineButton,
  redraw,
  sessionLine,
  showSessions,
  stateWords,
} from "#frame/sync/sessions.mjs";

/* The notification center. Waiting for you lists the other sessions whose
   round waits for the reviewer's submission. New and Earlier list what
   happened in every session, newest first, from the last 50 events the hub
   keeps for each. Which events this browser has seen, opened and cleared
   stays in its storage for the hub, so every tab on the hub shares it and
   each browser keeps its own. */

// The bell's number counts the waiting sessions and the events not yet
// seen. Its tone is "need" while a session waits and "news" when only
// events are new.
export function bellNumber(waiting, events, memory) {
  const unseen = events.filter(
    (event) => !memory.seen.has(event.id) && !memory.cleared.has(event.id),
  ).length;
  return {
    count: waiting + unseen,
    tone: waiting ? "need" : unseen ? "news" : "",
  };
}

const prefix = "pair:center:";
const kinds = ["seen", "opened", "cleared"];
// The IDs, kept here too when browser storage is unavailable.
const fallback = new Map();
function load(kind) {
  try {
    const saved = localStorage.getItem(prefix + kind);
    if (saved) return new Set(JSON.parse(saved));
  } catch {
    /* Storage is blocked; the copy below is this tab's. */
  }
  return new Set(fallback.get(kind));
}
function store(kind, ids) {
  fallback.set(kind, [...ids]);
  try {
    localStorage.setItem(prefix + kind, JSON.stringify([...ids]));
  } catch {
    /* Keep the copy above. */
  }
}
const memory = () =>
  Object.fromEntries(kinds.map((kind) => [kind, load(kind)]));
function mark(kind, ids) {
  const known = load(kind);
  const size = known.size;
  for (const id of ids) known.add(id);
  if (known.size !== size) store(kind, known);
}
// An event the hub no longer lists never returns, so its ID goes.
function forget(listed) {
  for (const kind of kinds) {
    const known = load(kind);
    const kept = [...known].filter((id) => listed.has(id));
    if (kept.length !== known.size) store(kind, kept);
  }
}

let latest = [];
let events = [];
// The events under New while the center is open: those not seen when it
// opened, and any that arrive while it stays open.
let fresh = null;

// This tab's own events already show where they happened: its pages in
// the Pages list, a reply on its thread's card, side work on Agreed. A
// page's event never shows here, and counts as seen while the tab is in
// view. A reply or side work counts as seen and opened once its card or
// item is in the reading area's view.
function inView(element) {
  if (!element) return false;
  const box = element.getBoundingClientRect();
  const area = document.querySelector("main").getBoundingClientRect();
  return (
    box.bottom > Math.max(area.top, 0) &&
    box.top < Math.min(area.bottom, innerHeight)
  );
}
function onScreen(event) {
  if ($("reading").hidden) return false;
  if (event.kind === "reply")
    return inView(
      [...$("page-content").querySelectorAll("pair-thread")].find(
        (card) => card.dataset.thread === event.thread,
      ),
    );
  return page.id === "agreed" && inView($(event.target));
}
function ownEvents(entry) {
  const listed = entry.events.filter((event) => event.kind !== "page");
  if (document.visibilityState === "visible") {
    const shown = listed.filter(onScreen).map(({ id }) => id);
    mark("seen", [
      ...entry.events
        .filter((event) => event.kind === "page")
        .map(({ id }) => id),
      ...shown,
    ]);
    mark("opened", shown);
  }
  return listed;
}

// fromHub says the sessions came from the hub, so an ID they lack is gone
// for good.
export function renderCenter(sessions, fromHub) {
  latest = sessions;
  if (fromHub)
    forget(
      new Set(sessions.flatMap((entry) => entry.events.map(({ id }) => id))),
    );
  events = sessions
    .flatMap((entry) =>
      (entry.id === session.sessionId ? ownEvents(entry) : entry.events).map(
        (event) => ({ ...event, entry }),
      ),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  let known = memory();
  events = events.filter((event) => !known.cleared.has(event.id));
  if (fresh) {
    const arrived = events.filter((event) => !known.seen.has(event.id));
    for (const event of arrived) fresh.add(event.id);
    mark(
      "seen",
      arrived.map(({ id }) => id),
    );
    known = memory();
  }
  const others = sessions.filter((entry) => entry.id !== session.sessionId);
  const waiting = others.filter((entry) => entry.needsYou);
  const { count, tone } = bellNumber(waiting.length, events, known);
  const bell = $("bell");
  bell.hidden = !others.length && !events.length;
  bell.classList.toggle("need", tone === "need");
  bell.classList.toggle("news", tone === "news");
  $("bell-count").hidden = !count;
  $("bell-count").textContent = String(count);
  const unseen = count - waiting.length;
  bell.setAttribute(
    "aria-label",
    count
      ? `Notifications: ${[
          waiting.length &&
            `${plural(waiting.length, "session")} waiting for you`,
          unseen && `${unseen} new`,
        ]
          .filter(Boolean)
          .join(", ")}`
      : "Notifications",
  );
  document.title = (count ? `(${count}) ` : "") + plan.title;
  if (bell.hidden && $("center-dialog").open) $("center-dialog").close();
  drawCenter(waiting, known);
}

function section(label, lines, clear) {
  if (!lines.length) return [];
  const head = document.createElement("div");
  head.className = "side-label";
  const name = document.createElement("span");
  name.textContent = label;
  head.append(name);
  if (clear) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-btn";
    button.dataset.key = `clear:${label}`;
    button.textContent = "Clear";
    button.onclick = clear;
    head.append(button);
  }
  const list = document.createElement("div");
  list.className = "session-list";
  list.append(...lines);
  return [head, list];
}
function eventLine(event, known) {
  return sessionLine({
    key: `open:${event.id}`,
    title: eventTitle(event),
    words: `${event.entry.title} · ${ago(event.at)}`,
    tint: known.opened.has(event.id) ? "" : "new",
    open: () => openEvent(event),
    icons: [
      null,
      lineButton(`clear:${event.id}`, "Clear", "✕", () => clear([event.id])),
    ],
  });
}
function drawCenter(waiting, known) {
  if (!$("center-dialog").open) return;
  const newer = events.filter((event) => fresh?.has(event.id));
  const earlier = events.filter((event) => !fresh?.has(event.id));
  const ids = (list) => list.map(({ id }) => id);
  const parts = [
    ...section(
      "Waiting for you",
      waiting.map((entry) =>
        sessionLine({
          key: `open:${entry.id}`,
          title: entry.title,
          state: stateWords(entry),
          words: ` · round ${entry.round} · ${ago(entry.updatedAt)}`,
          tint: "need",
          open: () => location.assign(entry.url),
          icons: [],
        }),
      ),
    ),
    ...section(
      "New",
      newer.map((event) => eventLine(event, known)),
      () => clear(ids(newer)),
    ),
    ...section(
      "Earlier",
      earlier.map((event) => eventLine(event, known)),
      () => clear(ids(earlier)),
    ),
  ];
  if (!parts.length) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent = "Nothing new.";
    parts.push(empty);
  }
  redraw($("center-list"), parts);
  $("center-all").textContent = `All live sessions (${latest.length})`;
}
function clear(ids) {
  mark("cleared", ids);
  renderCenter(latest, false);
}
// An event opens where it happened. In this tab's own round that is a page
// change, and anywhere else a new address.
function openEvent(event) {
  mark("seen", [event.id]);
  mark("opened", [event.id]);
  $("center-dialog").close();
  const here =
    event.entry.id === session.sessionId &&
    (!event.round || event.round === plan.round) &&
    pages.some((item) => item.id === event.page);
  if (here) show(event.page, event.target || null);
  else location.assign(eventHref(event.entry, event));
}
export function toggleCenter(open = !$("center-dialog").open) {
  if (!open) {
    if ($("center-dialog").open) $("center-dialog").close();
    return;
  }
  if ($("bell").hidden) return;
  // Opening the center marks its events seen, and they stay under New until
  // it closes.
  const known = memory();
  fresh = new Set(
    events.filter((event) => !known.seen.has(event.id)).map(({ id }) => id),
  );
  mark("seen", [...fresh]);
  $("center-dialog").showModal();
  renderCenter(latest, false);
}
export function installCenter() {
  $("center-dialog").addEventListener("close", () => {
    fresh = null;
  });
  $("center-all").onclick = showSessions;
  // Another tab on the hub saw, opened or cleared something.
  window.addEventListener("storage", (event) => {
    if (event.key?.startsWith(prefix)) renderCenter(latest, false);
  });
}
