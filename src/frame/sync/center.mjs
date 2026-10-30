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
import { onCurrentAgreed } from "#frame/notes/threads.mjs";
import { show, updateNavigation } from "#frame/pages/pages.mjs";
import { refreshWork } from "#frame/pages/work.mjs";
import {
  announced,
  eventHref,
  eventTarget,
  eventTitle,
} from "#frame/sync/notifications.mjs";
import { hubRecord } from "#frame/sync/record.mjs";
import {
  openPast,
  remote,
  selectedTab,
  switchTab,
} from "#frame/sync/rounds.mjs";
import { lineButton, redraw, sessionLine } from "#frame/sync/sessions.mjs";

/* The hub stores the IDs of the events that the reviewer cleared from the
   bell, so every browser on the hub, such as a phone's, shows the same
   lines. A page built before the bell existed contains the older
   notification center, which reads its own pair:center: keys, so the bell
   uses the separate key pair:bell:cleared. */

const cleared = hubRecord("cleared", "pair:bell:cleared", () =>
  window.dispatchEvent(new CustomEvent("pair:cleared")),
);
export const loadCleared = cleared.load;
export const isClearedChange = cleared.isChange;
function clear(ids) {
  cleared.add(ids);
  renderCenter(latest, false);
}
export function clearThread(threadId) {
  clear(
    latest.flatMap((entry) =>
      (entry.events || [])
        .filter((event) => event.thread === threadId)
        .map(({ id }) => id),
    ),
  );
}
// acknowledgeReply updates the listed event at once, so the bell drops or
// restores the reply's line before the next session list from the hub.
export function acknowledgeReply(threadId, message, acknowledged) {
  for (const entry of latest)
    for (const event of entry.events || [])
      if (event.thread === threadId && event.message === message)
        event.acknowledged = acknowledged;
  renderCenter(latest, false);
}
export const settleCleared = (listed, cleared) =>
  new Set([...cleared].filter((id) => listed.includes(id)));

// A tab already shows its own session, so bellLines leaves out that
// session's start and waiting round.
const shownKinds = ["session", "waiting"];
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

// latest contains every session from the last session list, closed ones
// included.
let latest = [];
let lines = [];
let listedFromHub = false;
export const sessionsListed = () => listedFromHub;
export const listedSession = (id) =>
  (id && latest.find((entry) => entry.id === id)) || null;
// sessionWords puts the parent's title first, so a long sub-session title
// cannot push the parent's title out of the line.
export function sessionWords(entry, sessions) {
  const parent =
    entry.parentId && sessions.find((item) => item.id === entry.parentId);
  return parent
    ? `Sub-session of ${parent.title} · ${entry.title}`
    : entry.title;
}
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
// fromHub is true when the sessions came from the hub, and an event missing
// from them is then gone for good. hub is the hub's list of cleared IDs.
export function renderCenter(sessions, fromHub, hub) {
  latest = sessions;
  if (fromHub) {
    listedFromHub = true;
    const listed = sessions.flatMap((entry) =>
      (entry.events || []).map(({ id }) => id),
    );
    // A visible tab has shown its own session's start and waiting round, so
    // renderCenter clears them, and the bell does not list them after the
    // reviewer moves to another session.
    const own = sessions.find((entry) => entry.id === session.sessionId);
    const shown =
      own && document.visibilityState === "visible"
        ? (own.events || []).filter((event) => shownKinds.includes(event.kind))
        : [];
    // When neither this browser nor the hub has a list, the last argument
    // counts every listed event as cleared, so the first run after the
    // upgrade shows an empty bell.
    cleared.sync(
      hub,
      (ids) => {
        const after = settleCleared(listed, ids);
        for (const event of shown) after.add(event.id);
        return after;
      },
      () => new Set(listed),
    );
  }
  lines = bellLines(sessions, loadCleared(), session.sessionId);
  const count = lines.length;
  const bell = $("bell");
  // The bell shows while the hub lists any live session, this tab's own
  // included, so the n key works with one session.
  bell.hidden = !sessions.some((entry) => !entry.closed);
  bell.classList.toggle("need", count > 0);
  $("bell-count").hidden = !count;
  $("bell-count").textContent = String(count);
  bell.setAttribute(
    "aria-label",
    count ? `Notifications: ${count}` : "Notifications",
  );
  document.title = (count ? `(${count}) ` : "") + plan.title;
  if (bell.hidden) toggleCenter(false);
  drawCenter();
  // Work counts a card with an unread reply as needing the reviewer, so
  // renderCenter refreshes Work.
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
function openEvent(event) {
  clear([event.id]);
  toggleCenter(false);
  const target = eventTarget(event) || null;
  const round = event.round || plan.round;
  const own = event.entry.id === session.sessionId;
  if (own && event.page === "work" && editable) show("work", target);
  else if (own && onCurrentAgreed(target)) {
    if (selectedTab !== "current")
      switchTab("current", null, { showPage: false });
    show("agreed", target);
  } else if (
    own &&
    round === plan.round &&
    !showingWaiting() &&
    (event.page === "overall" || pages.some((item) => item.id === event.page))
  )
    show(event.page, target);
  // A read-only page has no Previous tab, so openEvent opens another round
  // under Previous only on an editable page.
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
  // The storage event fires when another tab in this browser clears a line.
  window.addEventListener("storage", (event) => {
    if (cleared.isChange(event)) renderCenter(latest, false);
  });
}
