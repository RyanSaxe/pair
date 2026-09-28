/* Which pages this browser has opened, in every session on the hub, so a
   session's row can count the pages you have not opened and its Pages list
   can mark them New. It stays in this browser's storage for the hub, so
   every tab on the hub shares it. Only the pages of each session's current
   round are kept, because a past round shows no New marks. */

const storageKey = "pair:pages:opened";
// The record, kept here too when browser storage is unavailable. Null means
// this browser has never recorded anything.
let fallback = null;

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
/* The record after a listing from the hub. A browser with no record adopts
   every listed page as opened, so the upgrade starts with no "new" counts.
   After that, a page of a session the hub no longer lists, or of a round a
   session has moved on from, is dropped. */
export function settle(sessions, opened) {
  if (!opened) return new Set(sessions.flatMap(listedKeys));
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

export function openedPages() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) return new Set(JSON.parse(saved));
  } catch {
    /* Storage is blocked; the copy below is this tab's. */
  }
  return fallback && new Set(fallback);
}
function store(opened) {
  fallback = [...opened];
  try {
    localStorage.setItem(storageKey, JSON.stringify(fallback));
  } catch {
    /* Keep the copy above. */
  }
}
// Until the first listing from the hub, a browser has no record, and that
// listing adopts the page on screen with every other one.
export function markOpened(sessionId, round, pageId) {
  const opened = openedPages();
  const key = pageKey(sessionId, round, pageId);
  if (!opened || opened.has(key)) return false;
  opened.add(key);
  store(opened);
  return true;
}
export function syncOpened(sessions) {
  const before = openedPages();
  const after = settle(sessions, before);
  if (!before || after.size !== before.size) store(after);
}
export const isOpenedChange = (event) => event.key === storageKey;
