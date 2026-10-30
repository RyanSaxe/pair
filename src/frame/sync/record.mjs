/* hubRecord keeps a copy of one of the hub's ID lists, such as the bell
   events that the reviewer cleared, in this browser's localStorage. A tab
   reads the copy while the hub is unreachable. Writing the copy fires a
   storage event, and the frame's other tabs in this browser redraw on it.
   Other browsers, such as a phone's, read the hub's list on their next poll
   of the session list. `name` is the list's name on the hub. load() returns
   null when neither the hub nor this browser has recorded anything yet. */
const same = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));
export function hubRecord(name, storageKey, changed = () => {}) {
  let fallback = null;
  // listed is true once a session list has come from the hub. kept is true
  // when that hub stores this list, so send() can post to it.
  let listed = false;
  let kept = false;
  function load() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return new Set(JSON.parse(saved));
    } catch {
      /* localStorage is blocked, so this tab uses the copy in memory. */
    }
    return fallback && new Set(fallback);
  }
  function store(ids) {
    fallback = [...ids];
    try {
      localStorage.setItem(storageKey, JSON.stringify(fallback));
    } catch {
      /* localStorage is blocked, and fallback still contains the IDs. */
    }
    changed();
  }
  // When a post fails, the IDs stay in the copy, and sync() posts them again
  // after the next session list.
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
    listed: () => listed,
    add(ids) {
      const record = load() || new Set();
      const fresh = [...new Set(ids)].filter((id) => !record.has(id));
      if (!fresh.length) return false;
      for (const id of fresh) record.add(id);
      store(record);
      send(fresh);
      return true;
    },
    // After sync(), load() returns null only when the hub had no list
    // either, so adopt starts both lists with ids.
    adopt(ids) {
      if (!listed || load()) return;
      store(new Set(ids));
      send([...ids]);
    },
    /* sync runs after each session list from the hub. hub is the hub's
       list. It is null when no browser has sent one, and undefined from an
       older hub that stores no lists. settle(ids) drops the IDs that the
       session list no longer shows and adds the ones this tab counts as
       seen. adopt() returns the IDs to start with when neither this browser
       nor the hub has a list. sync then posts every ID that this browser has
       and the hub lacks, such as IDs from before the hub stored lists or
       from a time when the hub was unreachable. */
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
