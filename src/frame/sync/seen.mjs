/* Which proposal cards this browser has had on screen on Work, in every
   session on the hub, so a card it has not shown there reads New. It stays
   in this browser's storage for the hub, so every tab on the hub shares
   it, as the opened pages do. */

const storageKey = "pair:cards:seen";
// The record, kept here too when browser storage is unavailable. Null means
// this browser has never recorded anything.
let fallback = null;

export const cardKey = (sessionId, cardId) => `${sessionId}/${cardId}`;

export function seenCards() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) return new Set(JSON.parse(saved));
  } catch {
    /* Storage is blocked; the copy below is this tab's. */
  }
  return fallback && new Set(fallback);
}
function store(seen) {
  fallback = [...seen];
  try {
    localStorage.setItem(storageKey, JSON.stringify(fallback));
  } catch {
    /* Keep the copy above. */
  }
}
// A browser with no record adopts every card the hub lists as seen, so
// the upgrade starts with no New cards.
export function adoptCards(sessionId, cards) {
  if (!seenCards()) store(cards.map((card) => cardKey(sessionId, card.id)));
}
export function markSeen(sessionId, ids) {
  const seen = seenCards() || new Set();
  const size = seen.size;
  for (const id of ids) seen.add(cardKey(sessionId, id));
  if (seen.size !== size) store(seen);
}
// After a listing from the hub, the cards of a session it no longer lists
// as open go.
export function syncSeen(sessions) {
  const seen = seenCards();
  if (!seen) return;
  const listed = new Set(sessions.map((entry) => entry.id));
  const kept = [...seen].filter((key) => listed.has(key.split("/")[0]));
  if (kept.length !== seen.size) store(kept);
}
