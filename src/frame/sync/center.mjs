import { callHook } from "#frame/app/hooks.mjs";
import { remote, selectedTab } from "#frame/app/state.mjs";
import { since } from "#frame/app/time.mjs";
import { lineButton, redraw } from "#frame/app/ui.mjs";
import { $, installPanel } from "#frame/app/util.mjs";
import {
  editable,
  embedded,
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
  bellLines,
  bellStateRows,
  clear,
  cleared,
  listedSessions,
  loadCleared,
  setBellState,
  settleCleared,
  unreadEventIds,
} from "#frame/sync/center-state.mjs";
import { eventHref, eventTarget } from "#frame/sync/notifications.mjs";

export {
  acknowledgeReply,
  bellLines,
  clear,
  clearOwnRound,
  clearRound,
  clearThread,
  isClearedChange,
  listedSession,
  listedSessions,
  loadCleared,
  settleCleared,
  unreadCards,
  unreadCount,
  unreadEventIds,
} from "#frame/sync/center-state.mjs";

const GLANCE_ROWS = 5;

// fromHub is true when the sessions came from the hub, and an event missing
// from them is then gone for good. hub is the hub's list of cleared IDs.
export function renderCenter(sessions, fromHub, hub) {
  if (fromHub) {
    const listed = sessions.flatMap((entry) =>
      (entry.events || []).map(({ id }) => id),
    );
    // When neither this browser nor the hub has a list, the last argument
    // counts every listed event as cleared, so the first run after the
    // upgrade shows an empty bell.
    cleared.sync(
      hub,
      (ids) => settleCleared(listed, ids),
      () => new Set(listed),
    );
  }
  const lines = bellLines(sessions, loadCleared(), session.sessionId);
  const rows = bellRows(lines, session.sessionId);
  setBellState(sessions, lines, rows);
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

function glancePart(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function glanceLine(row) {
  const line = document.createElement("div");
  line.className = "session-line";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "session-row";
  open.dataset.key = `open:${row.key}`;
  const glyph = glancePart("glance-glyph");
  glyph.innerHTML = glyphOf(row);
  open.append(
    glyph,
    glancePart("title", row.words),
    glancePart("when", since(row.at)),
  );
  open.append(glancePart("where", glanceText(row)));
  open.addEventListener("click", () => {
    clear(row.events);
    openPlace(row);
  });
  const close = lineButton({
    key: `clear:${row.key}`,
    label: "Clear",
    content: "✕",
    onClick: () => clear(row.events),
  });
  close.title = "Clear";
  line.append(open, close);
  return line;
}

function drawCenter() {
  if (!isOpen()) return;
  const rows = bellStateRows();
  const more = rows.length - GLANCE_ROWS;
  $("center-all").textContent =
    more > 0 ? `See ${more} more` : "All notifications";
  $("center-clear-all").hidden = !rows.length;
  $("center-empty").hidden = Boolean(rows.length);
  redraw($("center-list"), rows.slice(0, GLANCE_ROWS).map(glanceLine));
}

function pageExistsOnCurrentView(eventPage) {
  return (
    ["overall", "feedback"].includes(eventPage) ||
    pages.some((item) => item.id === eventPage)
  );
}

function openOwnLine(event, { target, round, match }) {
  if (event.page === "work" && editable) {
    show("work", target, { match });
    return true;
  }
  if (onCurrentAgreed(target)) {
    if (selectedTab !== "current") {
      callHook("switchTab", "current", null, { showPage: false });
    }
    show("agreed", target, { match });
    return true;
  }
  if (
    round === plan.round &&
    !showingWaiting() &&
    pageExistsOnCurrentView(event.page)
  ) {
    show(event.page, target, { match });
    return true;
  }
  return false;
}

function openOwnOtherRound(event, { target, round, match }) {
  if (!editable) return false;
  // A read-only page has no Previous tab, so openEvent opens another round
  // under Previous only on an editable page.
  if (round !== remote.current.round || waiting()) {
    void callHook("openPast", round, {
      pageId: event.page,
      targetId: target,
      match,
    });
    return true;
  }
  if (selectedTab === "past") {
    callHook("openCurrent", { pageId: event.page, targetId: target, match });
    return true;
  }
  return false;
}

// A bell line and a search result both open a place here. A result also carries
// the words to highlight, and has its own address for when it needs a page load.
export function openLine(event) {
  toggleCenter(false);
  const target = eventTarget(event) || null;
  const round = event.round || plan.round;
  const own = event.entry.id === session.sessionId;
  const match = event.match ?? null;
  if (own && openOwnLine(event, { target, round, match })) return;
  if (own && openOwnOtherRound(event, { target, round, match })) return;
  if (embedded) show(event.page, target, { match });
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
  $("center-clear-all").addEventListener("click", () =>
    clear(unreadEventIds()),
  );
  $("center-all").addEventListener("click", () => openNotifications());
  // The storage event fires when another tab in this browser clears a line.
  window.addEventListener("storage", (event) => {
    if (cleared.isChange(event)) renderCenter(listedSessions(), false);
  });
}
