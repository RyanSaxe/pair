import { ago, since } from "#frame/app/time.mjs";
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
  openCurrent,
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

// threadGroups gives the Threads tab every thread waiting on an agent, across
// the live sessions and newest first, so the reviewer finds an unanswered
// thread without knowing its session. Answered threads stay in one group per
// session, newest first, with this session first and then the session with the
// latest reply.
export function threadGroups(sessions, thisId) {
  const live = sessions.filter((entry) => !entry.closed && entry.threads);
  const byAnswer = (a, b) =>
    (b.answeredAt || "").localeCompare(a.answeredAt || "");
  return {
    waiting: live
      .flatMap((entry) =>
        entry.threads
          .filter((line) => line.waitingSince)
          .map((line) => ({ line, entry })),
      )
      .sort((a, b) => b.line.waitingSince.localeCompare(a.line.waitingSince)),
    answered: live
      .map((entry) => ({
        entry,
        lines: entry.threads
          .filter((line) => !line.waitingSince)
          .sort(byAnswer),
      }))
      .filter(({ lines }) => lines.length)
      .sort(
        (a, b) =>
          (b.entry.id === thisId) - (a.entry.id === thisId) ||
          byAnswer(a.lines[0], b.lines[0]),
      ),
  };
}
// latest contains every session from the last session list, closed ones
// included.
let latest = [];
let lines = [];
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
  // A card on Work reads Agent replied while the bell lists its reply, and
  // Waiting for you while its linked session has a round waiting, so
  // renderCenter refreshes Work.
  if (mode !== "home") {
    updateNavigation();
    refreshWork();
  }
}

let tab = "notifications";
function threadRow(line, entry) {
  const opened = line.readAt ? "Read, no reply" : "Not opened";
  const place = entry.id === session.sessionId ? line.name : entry.title;
  return sessionLine({
    key: `thread:${line.thread}`,
    title: line.text,
    state: line.waitingSince ? `${opened} · ${since(line.waitingSince)}` : "",
    words: line.waitingSince
      ? ` · ${place}`
      : `${line.name} · replied ${ago(line.answeredAt)}`,
    tint: line.waitingSince ? (line.readAt ? "" : "unopened") : "answered",
    open: () => {
      clearThread(line.thread);
      openLine({ ...line, entry });
    },
    icons: [],
  });
}
function groupHead(words, tint = "") {
  const head = document.createElement("div");
  head.className = `center-group ${tint}`.trim();
  head.textContent = words;
  return head;
}
function threadRows() {
  const { waiting, answered } = threadGroups(latest, session.sessionId);
  const after = answered.flatMap(({ entry, lines }) => [
    groupHead(entry.title),
    ...lines.map((line) => threadRow(line, entry)),
  ]);
  if (!waiting.length) return after;
  return [
    groupHead(`Waiting on the agent · ${waiting.length}`, "waiting"),
    ...waiting.map(({ line, entry }) => threadRow(line, entry)),
    ...(after.length ? [document.createElement("hr")] : []),
    ...after,
  ];
}
function drawCenter() {
  if (!isOpen()) return;
  const threads = tab === "threads";
  for (const button of $("center-tabs").querySelectorAll("[data-center]"))
    button.setAttribute("aria-checked", String(button.dataset.center === tab));
  $("center-list").classList.toggle("threads", threads);
  $("center-clear-all").hidden = threads || !lines.length;
  if (threads) {
    const rows = threadRows();
    $("center-empty").textContent = "No threads in the current rounds.";
    $("center-empty").hidden = Boolean(rows.length);
    redraw($("center-list"), rows);
    return;
  }
  $("center-empty").textContent = "No notifications.";
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
  openLine(event);
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
  $("center-clear-all").onclick = () => clear(lines.map(({ id }) => id));
  $("center-tabs").addEventListener("click", (event) => {
    const chosen = event.target.closest("[data-center]")?.dataset.center;
    if (!chosen) return;
    tab = chosen;
    drawCenter();
  });
  // The storage event fires when another tab in this browser clears a line.
  window.addEventListener("storage", (event) => {
    if (cleared.isChange(event)) renderCenter(latest, false);
  });
}
