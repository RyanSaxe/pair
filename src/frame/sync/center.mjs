import { since } from "#frame/app/time.mjs";
import { $, installPanel } from "#frame/app/util.mjs";
import {
  editable,
  mode,
  pages,
  plan,
  session,
  showingWaiting,
  waiting,
  embedded,
} from "#frame/app/view.mjs";
import { onCurrentAgreed } from "#frame/notes/threads.mjs";
import { show, updateNavigation } from "#frame/pages/pages.mjs";
import { refreshWork } from "#frame/pages/work.mjs";
import {
  bellRows,
  glanceText,
  glyphOf,
} from "#frame/search/notification-rows.mjs";
import {
  openNotifications,
  openPlace,
  refreshNotifications,
} from "#frame/search/notifications.mjs";
import {
  announced,
  eventHref,
  eventTarget,
} from "#frame/sync/notifications.mjs";
import { hubRecord } from "#frame/sync/record.mjs";
import {
  openPast,
  remote,
  selectedTab,
  switchTab,
  openCurrent,
} from "#frame/sync/rounds.mjs";
import { lineButton, redraw } from "#frame/sync/sessions.mjs";

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
export function clear(ids) {
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

// The bell lists what needs the reviewer now, so it leaves out every session's
// start, and a tab already shows its own session's waiting round.
const shownKinds = ["session", "waiting"];
export function bellLines(sessions, cleared, thisId) {
  return sessions
    .filter((entry) => !entry.closed)
    .flatMap((entry) =>
      (entry.events || [])
        .filter(
          (event) =>
            event.kind !== "session" &&
            announced(entry, event) &&
            !(entry.id === thisId && event.kind === "waiting"),
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
let rows = [];
const GLANCE_ROWS = 5;
export const listedSessions = () => latest;
export const unreadCount = () => rows.length;
export const unreadEventIds = () => lines.map(({ id }) => id);
export const listedSession = (id) =>
  (id && latest.find((entry) => entry.id === id)) || null;
// Work's Agent replied label reads the raw lines, so the label and the bell agree.
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
// This session's unread replies and proposals, which the frame reads off the page
// once the reviewer has looked at them.
export const unreadHere = (kind) =>
  lines.filter(
    (event) => event.kind === kind && event.entry.id === session.sessionId,
  );
// fromHub is true when the sessions came from the hub, and an event missing
// from them is then gone for good. hub is the hub's list of cleared IDs.
export function renderCenter(sessions, fromHub, hub) {
  latest = sessions;
  if (fromHub) {
    const listed = sessions.flatMap((entry) =>
      (entry.events || []).map(({ id }) => id),
    );
    // A tab with focus has shown its own session's start and waiting round,
    // so renderCenter clears them, and the bell does not list them after the
    // reviewer moves to another session. A tab can be visible in a window
    // beside the one the reviewer is using, and clearing the lines from there
    // would take them out of every tab's bell before the reviewer saw them.
    const own = sessions.find((entry) => entry.id === session.sessionId);
    const shown =
      own && document.hasFocus()
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
  rows = bellRows(lines, session.sessionId);
  const count = rows.length;
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
  refreshNotifications(fromHub);
  // A card on Work reads Agent replied while the bell lists its reply, and
  // Waiting for you while its linked session has a round waiting, so
  // renderCenter refreshes Work.
  if (mode !== "home") {
    updateNavigation();
    refreshWork();
  }
}

function glanceLine(row) {
  const line = document.createElement("div");
  line.className = "session-line";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "session-row";
  open.dataset.key = `open:${row.key}`;
  const part = (className, text) => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  };
  const glyph = part("glance-glyph");
  glyph.innerHTML = glyphOf(row);
  open.append(glyph, part("title", row.words), part("when", since(row.at)));
  open.append(part("where", glanceText(row)));
  open.onclick = () => {
    clear(row.events);
    openPlace(row);
  };
  const close = lineButton(`clear:${row.key}`, "Clear", "✕", () =>
    clear(row.events),
  );
  close.title = "Clear";
  line.append(open, close);
  return line;
}
function drawCenter() {
  if (!isOpen()) return;
  const more = rows.length - GLANCE_ROWS;
  $("center-all").textContent =
    more > 0 ? `See ${more} more` : "All notifications";
  $("center-clear-all").hidden = !rows.length;
  $("center-empty").hidden = Boolean(rows.length);
  redraw($("center-list"), rows.slice(0, GLANCE_ROWS).map(glanceLine));
}
// A bell line and a search result both open a place here. A result also carries
// the words to highlight, and has its own address for when it needs a page load.
export function openLine(event) {
  toggleCenter(false);
  const target = eventTarget(event) || null;
  const round = event.round || plan.round;
  const own = event.entry.id === session.sessionId;
  const match = event.match ?? null;
  if (own && event.page === "work" && editable) show("work", target, { match });
  else if (own && onCurrentAgreed(target)) {
    if (selectedTab !== "current")
      switchTab("current", null, { showPage: false });
    show("agreed", target, { match });
  } else if (
    own &&
    round === plan.round &&
    !showingWaiting() &&
    (["overall", "feedback"].includes(event.page) ||
      pages.some((item) => item.id === event.page))
  )
    show(event.page, target, { match });
  // A read-only page has no Previous tab, so openEvent opens another round
  // under Previous only on an editable page.
  else if (own && editable && (round !== remote.current.round || waiting()))
    void openPast(round, { pageId: event.page, targetId: target, match });
  else if (own && editable && selectedTab === "past")
    openCurrent({ pageId: event.page, targetId: target, match });
  else if (embedded) show(event.page, target, { match });
  else location.assign(event.href ?? eventHref(event.entry, event));
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
  $("center-clear-all").onclick = () => clear(unreadEventIds());
  $("center-all").onclick = () => openNotifications();
  // The storage event fires when another tab in this browser clears a line.
  window.addEventListener("storage", (event) => {
    if (cleared.isChange(event)) renderCenter(latest, false);
  });
}
