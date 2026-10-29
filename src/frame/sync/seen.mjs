import { hubRecord } from "#frame/sync/record.mjs";

/* Which proposal cards Work has had on screen, in every session on the
   hub, so a card it has not shown reads New. The hub keeps it, so every
   browser on the hub, such as a phone's, marks the same cards. */

const seen = hubRecord("cards", "pair:cards:seen");

export const cardKey = (sessionId, cardId) => `${sessionId}/${cardId}`;

export const seenCards = seen.load;
// A browser with no record, on a hub with none, adopts every card the hub
// lists as seen, so the upgrade starts with no New cards. It waits for the
// session list, which brings the hub's record.
export function adoptCards(sessionId, cards) {
  seen.adopt(cards.map((card) => cardKey(sessionId, card.id)));
}
export function markSeen(sessionId, ids) {
  seen.add(ids.map((id) => cardKey(sessionId, id)));
}
// After a listing from the hub, the cards of a session it no longer lists
// as open go. hub is the hub's record of seen cards.
export function syncSeen(sessions, hub) {
  const listed = new Set(sessions.map((entry) => entry.id));
  seen.sync(
    hub,
    (keys) => new Set([...keys].filter((key) => listed.has(key.split("/")[0]))),
  );
}
