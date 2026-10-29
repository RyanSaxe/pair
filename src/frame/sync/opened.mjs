import { hubRecord } from "#frame/sync/record.mjs";

/* Which pages the reviewer has opened, in every session on the hub, so a
   session's row can count the pages not opened yet and its Pages list can
   mark them New. The hub keeps it, so every browser on the hub, such as a
   phone's, counts the same pages. Only the pages of each session's current
   round are kept, because a past round shows no New marks. */

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
// A browser with no record, on a hub with none, adopts every listed page as
// opened, so the upgrade starts with no "new" counts.
export const adoptOpened = (sessions) => new Set(sessions.flatMap(listedKeys));
// After a listing from the hub, a page of a session the hub no longer lists,
// or of a round a session has moved on from, is dropped.
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
// hub is the hub's record of opened pages.
export function syncOpened(sessions, hub) {
  opened.sync(
    hub,
    (keys) => settle(sessions, keys),
    () => adoptOpened(sessions),
  );
}
export const isOpenedChange = opened.isChange;
