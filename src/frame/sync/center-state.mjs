import { callHook } from "#frame/app/hooks.mjs";
import { selectedTab } from "#frame/app/state.mjs";
import { session } from "#frame/app/view.mjs";
import { announced } from "#frame/sync/notifications.mjs";
import { hubRecord } from "#frame/sync/record.mjs";

/* The hub stores the IDs of the events that the reviewer cleared from the
   bell, so every browser on the hub, such as a phone's, shows the same
   lines. A page built before the bell existed contains the older
   notification center, which reads its own pair:center: keys, so the bell
   uses the separate key pair:bell:cleared. */

export const cleared = hubRecord("cleared", "pair:bell:cleared", () =>
  window.dispatchEvent(new CustomEvent("pair:cleared")),
);
export const loadCleared = cleared.load;
export const isClearedChange = cleared.isChange;

// latest contains every session from the last session list, closed ones
// included.
let latest = [];
let lines = [];
let rows = [];

export const listedSessions = () => latest;
export const bellStateRows = () => rows;
export const unreadCount = () => rows.length;
export const unreadEventIds = () => lines.map(({ id }) => id);
export const listedSession = (id) =>
  (id && latest.find((entry) => entry.id === id)) || null;

export function setBellState(nextLatest, nextLines, nextRows) {
  latest = nextLatest;
  lines = nextLines;
  rows = nextRows;
}

export function clear(ids) {
  cleared.add(ids);
  callHook("renderCenter", latest, false);
}

// The reviewer has started on a session's waiting round once they open the
// session from the session list or with a key, or open one of its pages or a
// note themselves, so its line leaves the bell in every tab. A tab that only
// has focus, or moves to the round as it arrives, clears nothing.
export function clearRound(entry) {
  const known = loadCleared() ?? new Set();
  const waitingEvents = (entry?.events || []).filter(
    (event) =>
      event.kind === "waiting" &&
      event.round === entry.round &&
      !known.has(event.id),
  );
  if (waitingEvents.length) clear(waitingEvents.map(({ id }) => id));
}

export function clearOwnRound() {
  if (selectedTab !== "current") return;
  clearRound(latest.find((entry) => entry.id === session.sessionId));
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
  for (const entry of latest) {
    for (const event of entry.events || []) {
      if (event.thread === threadId && event.message === message) {
        event.acknowledged = acknowledged;
      }
    }
  }
  callHook("renderCenter", latest, false);
}

export const settleCleared = (listed, clearedIds) =>
  new Set([...clearedIds].filter((id) => listed.includes(id)));

// The bell lists what needs the reviewer now, so it leaves out every session's
// start, and a tab already shows its own session's waiting round.
export function bellLines(sessions, clearedIds, thisId) {
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
        .map((event) => Object.assign({}, event, { entry })),
    )
    .filter((event) => !clearedIds?.has(event.id))
    .toSorted((a, b) => b.at.localeCompare(a.at));
}

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
