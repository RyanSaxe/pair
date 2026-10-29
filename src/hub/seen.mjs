import { atomic, read, requireValue, serializer } from "../shared/util.mjs";

/* The hub keeps three lists of IDs for every browser on it, so a phone and
   a computer show the same bell, sessions badge and New marks. `cleared`
   contains the IDs of the bell events the reviewer cleared, `opened` a
   session/round/page key for each page they opened, and `cards` a
   session/card key for each proposal card Work showed them. A list is null
   until a browser sends it. A browser with no list of its own then sends
   every ID the session list shows, so the upgrade starts with nothing new. */
export const records = ["cleared", "opened", "cards"];

// Drops each ID the session listing no longer shows, by the rules the frame
// uses for its copy. It keeps a cleared event that the listing still has, a
// page of an open session's current round, and a card of an open session.
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
  // The hub answers requests before it has loaded every session from disk.
  // It prunes only after loaded() runs, so a listing that lacks a session
  // still loading drops none of that session's IDs.
  let whole = false;
  const pruned = (next, sessions) => (whole ? prune(next, sessions) : next);
  const keep = (next) => {
    const changed = JSON.stringify(next) !== JSON.stringify(record);
    record = next;
    return changed ? write(() => atomic(file, next)) : undefined;
  };
  return {
    loaded: () => (whole = true),
    // Returns the lists, pruned against this listing.
    async view(sessions) {
      await keep(pruned(record, sessions));
      return record;
    },
    // Adds the IDs a browser sends. A list that was null becomes the IDs
    // sent, even an empty list, so the hub records that a browser started it.
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
        "Send cleared, opened or cards, each as a list of IDs.",
      );
      const next = { ...record };
      for (const [name, ids] of Object.entries(data))
        next[name] = [...new Set([...(record[name] || []), ...ids])];
      await keep(pruned(next, sessions));
      return record;
    },
  };
}
