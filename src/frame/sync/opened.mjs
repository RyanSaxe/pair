import { hubRecord } from "#frame/sync/record.mjs";

/* The hub stores the pages that the reviewer has opened, across every
   session, so a phone and a computer count the same unopened pages. The
   frame counts each session's unopened pages in the session list and marks
   them New in the page list. The list contains only the pages of each
   session's current round, because the frame shows no New marks on a past
   round. */

const opened = hubRecord("opened", "pair:pages:opened");

export const pageKey = (sessionId, round, pageId) =>
  `${sessionId}/${round}/${pageId}`;
const listedKeys = (entry) =>
  (entry.readyPages?.ids || []).map((id) =>
    pageKey(entry.id, entry.readyPages.round, id),
  );

export function countUnopened(entry, opened) {
  if (!opened) return 0;
  return listedKeys(entry).filter((key) => !opened.has(key)).length;
}
// When neither this browser nor the hub has a list, adoptOpened counts every
// listed page as opened, so the first run after the upgrade shows no New
// counts.
export const adoptOpened = (sessions) => new Set(sessions.flatMap(listedKeys));
// settle runs after each session list from the hub. It drops the pages of
// sessions that the hub no longer lists and of rounds that a session has
// moved past.
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
// Until the first session list from the hub, this browser has no list.
// adoptOpened then counts the page on screen as opened with every other
// page.
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
