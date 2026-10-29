import { atomic, read, requireValue, serializer } from "../shared/util.mjs";

/* The hub stores three lists of IDs that every browser shares, so a phone
   and a computer show the same bell, sessions badge and New marks. `cleared`
   contains the IDs of the bell events the reviewer cleared, `opened` a
   session/round/page key for each page they opened, and `cards` a
   session/card key for each proposal card the frame showed them on Work. A
   list is null until a browser sends it. The frame in a browser with no
   local copy of a list then sends every ID in the session listing, so after
   an upgrade nothing shows as new. */
export const records = ["cleared", "opened", "cards"];

// prune drops IDs by the same rules that the frame applies to its local copy
// of each list.
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
  // The hub answers requests before it loads every session from disk.
  // seenStore prunes only after loaded() runs, so it keeps the IDs of a
  // session that is still loading.
  let whole = false;
  const pruned = (next, sessions) => (whole ? prune(next, sessions) : next);
  const keep = (next) => {
    const changed = JSON.stringify(next) !== JSON.stringify(record);
    record = next;
    return changed ? write(() => atomic(file, next)) : undefined;
  };
  return {
    loaded: () => (whole = true),
    async view(sessions) {
      await keep(pruned(record, sessions));
      return record;
    },
    // A list that was null becomes the IDs sent, even an empty list, so the
    // hub records that a browser started it.
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
