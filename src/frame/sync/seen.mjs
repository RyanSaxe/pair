import { hubRecord } from "#frame/sync/record.mjs";

/* The hub stores the IDs of the proposal cards that the frame has shown on
   Work, across every session, so a phone and a computer label the same
   other cards New. */

const seen = hubRecord("cards", "pair:cards:seen");

export const cardKey = (sessionId, cardId) => `${sessionId}/${cardId}`;

export const seenCards = seen.load;
// When neither this browser nor the hub has a list, adoptCards counts every
// card the hub lists as seen, so the first run after the upgrade shows no
// New cards. seen.adopt() does nothing until the first session list
// arrives, because the frame reads the hub's list from it.
export function adoptCards(sessionId, cards) {
  seen.adopt(cards.map((card) => cardKey(sessionId, card.id)));
}
export function markSeen(sessionId, ids) {
  seen.add(ids.map((id) => cardKey(sessionId, id)));
}
// syncSeen runs after each session list from the hub and drops the cards of
// sessions that the hub no longer lists as open. hub is the hub's list of
// seen cards.
export function syncSeen(sessions, hub) {
  const listed = new Set(sessions.map((entry) => entry.id));
  seen.sync(
    hub,
    (keys) => new Set([...keys].filter((key) => listed.has(key.split("/")[0]))),
  );
}
