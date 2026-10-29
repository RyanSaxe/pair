import { hubRecord } from "#frame/sync/record.mjs";

/* The proposal cards Work has shown the reviewer, in every session on the
   hub. Work labels any other card New. The hub keeps the list, so a phone
   and a computer label the same cards. */

const seen = hubRecord("cards", "pair:cards:seen");

export const cardKey = (sessionId, cardId) => `${sessionId}/${cardId}`;

export const seenCards = seen.load;
// When neither this browser nor the hub has a list, every card the hub lists
// counts as seen, so the first run after the upgrade shows no New cards.
// seen.adopt() acts only after the session list arrives, because that list
// brings the hub's record.
export function adoptCards(sessionId, cards) {
  seen.adopt(cards.map((card) => cardKey(sessionId, card.id)));
}
export function markSeen(sessionId, ids) {
  seen.add(ids.map((id) => cardKey(sessionId, id)));
}
// After a listing from the hub, drops the cards of sessions it no longer
// lists as open. hub is the hub's list of seen cards.
export function syncSeen(sessions, hub) {
  const listed = new Set(sessions.map((entry) => entry.id));
  seen.sync(
    hub,
    (keys) => new Set([...keys].filter((key) => listed.has(key.split("/")[0]))),
  );
}
