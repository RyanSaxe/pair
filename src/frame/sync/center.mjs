import { ago } from "#frame/app/time.mjs";
import { $, installPanel } from "#frame/app/util.mjs";
import {
  editable,
  mode,
  pages,
  plan,
  session,
  showingWaiting,
  waiting,
} from "#frame/app/view.mjs";
import { show, updateNavigation } from "#frame/pages/pages.mjs";
import { refreshWork } from "#frame/pages/work.mjs";
import {
  announced,
  eventHref,
  eventTarget,
  eventTitle,
} from "#frame/sync/notifications.mjs";
import { openPast, remote } from "#frame/sync/rounds.mjs";
import { lineButton, redraw, sessionLine } from "#frame/sync/sessions.mjs";

/* The bell lists every session's starts, waiting rounds and agent replies,
   newest first, from the last 50 events the hub keeps for each. A line
   leaves the list when you click it or its ✕, when you reply in its
   thread or give the reply a thumbs up, or, for a waiting round, once you
   send that round. A session's start and waiting round also leave once a
   visible tab has shown that session, so they do not come back when you
   switch to another session. The bell's number is the number of lines.
   Which events this browser removed stays in its storage for the hub, so
   every tab on the hub shares it and each browser keeps its own. A round
   published before the bell's list came keeps the notification center,
   which reads its own pair:center: keys, so this list uses a key of its
   own and leaves those alone. */

const storageKey = "pair:bell:cleared";
// The removed IDs, kept here too when browser storage is unavailable. Null
// means this browser has never recorded anything.
let fallback = null;
function loadCleared() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) return new Set(JSON.parse(saved));
  } catch {
    /* Storage is blocked; the copy below is this tab's. */
  }
  return fallback && new Set(fallback);
}
function store(ids) {
  fallback = [...ids];
  try {
    localStorage.setItem(storageKey, JSON.stringify(fallback));
  } catch {
    /* Keep the copy above. */
  }
}
function clear(ids) {
  const cleared = loadCleared() || new Set();
  for (const id of ids) cleared.add(id);
  store(cleared);
  renderCenter(latest, false);
}
// A reply in a thread answers the agent's replies there, so their lines go.
export function clearThread(threadId) {
  clear(
    latest.flatMap((entry) =>
      (entry.events || [])
        .filter((event) => event.thread === threadId)
        .map(({ id }) => id),
    ),
  );
}
// A thumbs up on a reply takes its line out at once, and taking the thumbs
// up back returns it, before the next listing from the hub shows either.
export function acknowledgeReply(threadId, message, acknowledged) {
  for (const entry of latest)
    for (const event of entry.events || [])
      if (event.thread === threadId && event.message === message)
        event.acknowledged = acknowledged;
  renderCenter(latest, false);
}
/* The removed IDs after a listing from the hub. A browser with no record
   removes every listed event, so the change starts with an empty bell.
   After that, an ID the hub no longer lists never returns, so it goes. */
export function settleCleared(listed, cleared) {
  if (!cleared) return new Set(listed);
  return new Set([...cleared].filter((id) => listed.includes(id)));
}

// The tab already shows its own session, so that session's start and
// waiting round are not lines.
const shownKinds = ["session", "waiting"];
// The bell's lines: every listed event not removed, newest first.
export function bellLines(sessions, cleared, thisId) {
  return sessions
    .filter((entry) => !entry.closed)
    .flatMap((entry) =>
      (entry.events || [])
        .filter(
          (event) =>
            announced(entry, event) &&
            !(entry.id === thisId && shownKinds.includes(event.kind)),
        )
        .map((event) => ({ ...event, entry })),
    )
    .filter((event) => !cleared?.has(event.id))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// Every listed session, closed ones included, from the last listing.
let latest = [];
let lines = [];
let listedFromHub = false;
// Whether a listing has come from the hub, so a card's linked session can be
// looked up.
export const sessionsListed = () => listedFromHub;
// The listed session with the ID, such as the one a card's work runs in.
export const listedSession = (id) =>
  (id && latest.find((entry) => entry.id === id)) || null;
// A sub-session's line names the session it came from first, so a long
// name of its own cannot push the parent's out of the line.
export function sessionWords(entry, sessions) {
  const parent =
    entry.parentId && sessions.find((item) => item.id === entry.parentId);
  return parent
    ? `Sub-session of ${parent.title} · ${entry.title}`
    : entry.title;
}
// The proposals of this tab's session whose thread has an agent reply that
// is still a line in the bell.
export const unreadCards = () =>
  new Set(
    lines
      .filter(
        (event) =>
          event.kind === "reply" &&
          event.proposal &&
          event.entry.id === session.sessionId,
      )
      .map((event) => event.proposal),
  );
// fromHub says the sessions came from the hub, so an ID they lack is gone
// for good.
export function renderCenter(sessions, fromHub) {
  latest = sessions;
  if (fromHub) {
    listedFromHub = true;
    const before = loadCleared();
    const listed = sessions.flatMap((entry) =>
      (entry.events || []).map(({ id }) => id),
    );
    const after = settleCleared(listed, before);
    // A visible tab has shown its session's start and waiting round, so the
    // reviewer who leaves for another session is not told about them again.
    const own = sessions.find((entry) => entry.id === session.sessionId);
    if (own && document.visibilityState === "visible")
      for (const event of own.events || [])
        if (shownKinds.includes(event.kind)) after.add(event.id);
    if (
      !before ||
      after.size !== before.size ||
      [...after].some((id) => !before.has(id))
    )
      store(after);
  }
  lines = bellLines(sessions, loadCleared(), session.sessionId);
  const count = lines.length;
  const bell = $("bell");
  // The bell shows while the hub lists a live session, this tab's own
  // included, so n works with one session.
  bell.hidden = !sessions.some((entry) => !entry.closed);
  bell.classList.toggle("need", count > 0);
  $("bell-count").hidden = !count;
  $("bell-count").textContent = String(count);
  bell.setAttribute(
    "aria-label",
    count ? `Notifications: ${count}` : "Notifications",
  );
  // The tab's title counts the bell's lines.
  document.title = (count ? `(${count}) ` : "") + plan.title;
  if (bell.hidden) toggleCenter(false);
  drawCenter();
  // Work counts a card with an unread reply as one that needs the reviewer.
  if (mode !== "home") {
    updateNavigation();
    refreshWork();
  }
}

function drawCenter() {
  if (!isOpen()) return;
  $("center-clear-all").hidden = !lines.length;
  $("center-empty").hidden = Boolean(lines.length);
  redraw(
    $("center-list"),
    lines.map((event) =>
      sessionLine({
        key: `open:${event.id}`,
        title: eventTitle(event),
        words: `${sessionWords(event.entry, latest)} · ${ago(event.at)}`,
        tint: "",
        open: () => openEvent(event),
        icons: [
          lineButton(`clear:${event.id}`, "Clear", "✕", () =>
            clear([event.id]),
          ),
        ],
      }),
    ),
  );
}
// An event opens where it happened. In this tab's own round that is a page
// change, in another round of this session it opens under Previous, and
// anywhere else it is a new address. Opening it removes its line.
function openEvent(event) {
  clear([event.id]);
  toggleCenter(false);
  const target = eventTarget(event) || null;
  const round = event.round || plan.round;
  const own = event.entry.id === session.sessionId;
  if (own && event.page === "work" && editable) show("work", target);
  else if (
    own &&
    round === plan.round &&
    !showingWaiting() &&
    (event.page === "overall" || pages.some((item) => item.id === event.page))
  )
    show(event.page, target);
  // A round other than Current's, or the sent round while Current waits,
  // opens under Previous. A read-only page has no Previous tab.
  else if (own && editable && (round !== remote.current.round || waiting()))
    void openPast(round, { pageId: event.page, targetId: target });
  else location.assign(eventHref(event.entry, event));
}
const isOpen = () => $("center-pop").matches(":popover-open");
export function toggleCenter(open = !isOpen()) {
  if (!open) {
    if (isOpen()) $("center-pop").hidePopover();
    return;
  }
  if ($("bell").hidden || isOpen()) return;
  $("center-pop").showPopover();
}
export function installCenter() {
  installPanel($("center-pop"), $("bell"));
  $("center-pop").addEventListener("toggle", drawCenter);
  $("center-clear-all").onclick = () => clear(lines.map(({ id }) => id));
  // Another tab on the hub removed a line.
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey) renderCenter(latest, false);
  });
}
