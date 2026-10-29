import { hubRecord } from "#frame/sync/record.mjs";

/* The pages the reviewer has opened, in every session on the hub. The
   session list counts each session's unopened pages from it, and the page
   list marks those pages New. The hub keeps the list, so a phone and a
   computer count the same pages. The list contains only the pages of each
   session's current round, because a past round shows no New marks. */

const opened = hubRecord("opened", "pair:pages:opened");

export const pageKey = (sessionId, round, pageId) =>
  `${sessionId}/${round}/${pageId}`;
const listedKeys = (entry) =>
  (entry.readyPages?.ids || []).map((id) =>
    pageKey(entry.id, entry.readyPages.round, id),
  );

// How many of a listed session's ready pages are not in the opened set.
export function countUnopened(entry, opened) {
  if (!opened) return 0;
  return listedKeys(entry).filter((key) => !opened.has(key)).length;
}
// When neither this browser nor the hub has a list, every listed page counts
// as opened, so the first run after the upgrade shows no "new" counts.
export const adoptOpened = (sessions) => new Set(sessions.flatMap(listedKeys));
// After a listing from the hub, drops the pages of sessions the hub no
// longer lists and of rounds a session has moved on from.
export function settle(sessions, opened) {
  const rounds = new Map(
    sessions.map((entry) => [entry.id, entry.readyPages?.round]),
  );
  return new Set(
    [...opened].filter((key) => {
      const [sessionId, round] = key.split("/");
      return rounds.get(sessionId) === round;
    }),
  );
}

export const openedPages = opened.load;
// Until the first listing from the hub, a browser has no record, and that
// listing adopts the page on screen with every other one.
export function markOpened(sessionId, round, pageId) {
  if (!opened.load()) return false;
  return opened.add([pageKey(sessionId, round, pageId)]);
}
// hub is the hub's list of opened pages.
export function syncOpened(sessions, hub) {
  opened.sync(
    hub,
    (keys) => settle(sessions, keys),
    () => adoptOpened(sessions),
  );
}
export const isOpenedChange = opened.isChange;
