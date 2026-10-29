/* One set of IDs that the hub keeps for every browser on it, such as the
   bell lines the reviewer cleared, and the copy in this browser's storage.
   The copy keeps a tab working while the hub is unreachable, and its
   storage event redraws the other tabs of this browser at once. Other
   browsers, such as a phone's, read the hub's set on their next poll of the
   session list. name is the set's name on the hub. Null means neither the
   hub nor this browser has recorded anything. */
const same = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));
export function hubRecord(name, storageKey, changed = () => {}) {
  // The copy, kept here too when browser storage is unavailable.
  let fallback = null;
  // Whether a session list has come from the hub, and whether that hub
  // keeps the set, so a change can go to it.
  let listed = false;
  let kept = false;
  function load() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return new Set(JSON.parse(saved));
    } catch {
      /* Storage is blocked; the copy below is this tab's. */
    }
    return fallback && new Set(fallback);
  }
  function store(ids) {
    fallback = [...ids];
    try {
      localStorage.setItem(storageKey, JSON.stringify(fallback));
    } catch {
      /* Keep the copy above. */
    }
    changed();
  }
  // An ID that does not reach the hub stays in the copy, and the next
  // session list sends it again.
  function send(ids) {
    if (!kept) return;
    fetch("/api/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [name]: ids }),
    }).catch(() => {});
  }
  return {
    load,
    isChange: (event) => event.key === storageKey,
    // Whether a session list has come from the hub.
    listed: () => listed,
    // Adds the IDs, and returns whether any was new.
    add(ids) {
      const record = load() || new Set();
      const fresh = [...new Set(ids)].filter((id) => !record.has(id));
      if (!fresh.length) return false;
      for (const id of fresh) record.add(id);
      store(record);
      send(fresh);
      return true;
    },
    // A browser with no record, on a hub with none, starts it with ids.
    adopt(ids) {
      if (!listed || load()) return;
      store(new Set(ids));
      send([...ids]);
    },
    /* After a session list from the hub. hub is the hub's set: null when
       the hub has none yet, and undefined from a hub that keeps none.
       settle drops what the list no longer shows and adds what the tab
       counts as seen, and adopt is the set a browser with no record starts
       with. The IDs this browser has and the hub lacks, such as its record
       from before the hub kept one or a change made while the hub was
       unreachable, go to the hub. */
    sync(hub, settle, adopt = () => null) {
      listed = true;
      kept = hub !== undefined;
      const local = load();
      const known = hub && new Set(hub);
      const base = known
        ? new Set([...known, ...(local || [])])
        : local || adopt();
      if (!base) return;
      const next = settle(base);
      const missing = [...next].filter((id) => !known?.has(id));
      if (!known || missing.length) send(missing);
      if (!local || !same(local, next)) store(next);
    },
  };
}
