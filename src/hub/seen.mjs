import { atomic, read, requireValue, serializer } from "../shared/util.mjs";

/* What the reviewer has already dealt with, kept by the hub for every
   browser on it, so a phone and a computer show the same bell, sessions
   badge and New marks. The frame names each ID: cleared holds the bell's
   event IDs, opened holds session/round/page keys, and cards holds
   session/card keys. A record is null until a browser first sends it,
   because a browser with no record of its own then starts the hub's with
   everything listed, and an upgrade starts with nothing new. */
export const records = ["cleared", "opened", "cards"];

// The IDs that the session listing still shows, by the rules the frame
// prunes its copy with: a cleared event the listing has, and a page of an
// open session's current round or a card of an open session.
export function prune(record, sessions) {
  const events = new Set(
    sessions.flatMap((entry) => (entry.events || []).map(({ id }) => id)),
  );
  const rounds = new Map(
    sessions
      .filter((entry) => !entry.closed)
      .map((entry) => [entry.id, entry.readyPages?.round]),
  );
  const keeps = {
    cleared: (id) => events.has(id),
    opened: (key) => {
      const [sessionId, round] = key.split("/");
      return rounds.get(sessionId) === round;
    },
    cards: (key) => rounds.has(key.split("/")[0]),
  };
  return Object.fromEntries(
    records.map((name) => [name, record[name]?.filter(keeps[name]) ?? null]),
  );
}

export async function seenStore(file, log) {
  let record = Object.fromEntries(records.map((name) => [name, null]));
  try {
    const saved = await read(file);
    for (const name of records)
      if (Array.isArray(saved[name]))
        record[name] = saved[name].filter((id) => typeof id === "string");
  } catch (error) {
    if (error.code !== "ENOENT")
      log(`started without ${file}: ${error.message}`);
  }
  const write = serializer();
  const keep = (next) => {
    const changed = JSON.stringify(next) !== JSON.stringify(record);
    record = next;
    return changed ? write(() => atomic(file, next)) : undefined;
  };
  return {
    // The record pruned against this listing, for the browser.
    async view(sessions) {
      await keep(prune(record, sessions));
      return record;
    },
    // A browser adds the IDs it cleared, opened or saw. A record the hub
    // has not kept yet starts with them, even with none.
    async add(data, sessions) {
      requireValue(
        data &&
          typeof data === "object" &&
          Object.entries(data).every(
            ([name, ids]) =>
              records.includes(name) &&
              Array.isArray(ids) &&
              ids.every((id) => typeof id === "string"),
          ),
        `The body names lists of IDs under ${records.join(", ")}.`,
      );
      const next = { ...record };
      for (const [name, ids] of Object.entries(data))
        next[name] = [...new Set([...(record[name] || []), ...ids])];
      await keep(prune(next, sessions));
      return record;
    },
  };
}
