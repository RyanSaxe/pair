/* The modal's side of the preview: the frames, one for each session, each loaded
   when a result first needs it. Moving between results in a session stays inside
   its frame, and the last few frames stay loaded, so going back to one is
   instant. A closed session is read-only, so its older rounds have frames of
   their own. */
const KEPT = 3;
// The selection can move faster than a frame can follow, so a result shows once
// it has been selected for a moment.
const REST_MS = 60;
// A frame not loaded yet costs a download, so it waits out a reader's typing.
const LOAD_REST_MS = 300;
const LOADING_AFTER_MS = 250;
const LOAD_LIMIT_MS = 60000;
const POLL_MS = 20;

const keyOf = (row) =>
  row.closed && row.round ? `${row.session}|${row.round}` : row.session;
const addressOf = (row) =>
  `/s/${row.session}/embed/${row.closed && row.round ? encodeURIComponent(row.round) : "latest"}`;

export function createPreview({ host, onShown, onFailed, onLoading, onKey }) {
  const frames = new Map();
  let shown = null;
  let restTimer = 0;
  let loadingTimer = 0;
  let turn = 0;

  // A key belongs to the frame while the reader writes there or has something
  // open in it. Any other key is the search window's.
  function listen(win) {
    win.addEventListener("keydown", (event) => {
      const writing = event.target.closest?.(
        "input, textarea, select, [contenteditable]",
      );
      const open = win.document.querySelector(
        "dialog[open], [popover]:popover-open",
      );
      // A closed dialog's field can hold focus for a moment after it closes.
      if (!writing?.checkVisibility() && !open) onKey(event);
    });
  }

  function load(row) {
    const key = keyOf(row);
    let entry = frames.get(key);
    if (entry) {
      frames.delete(key);
      frames.set(key, entry);
      return entry;
    }
    const frame = document.createElement("iframe");
    frame.className = "search-frame";
    frame.title = "The result, on its page";
    frame.tabIndex = -1;
    /* A page's own images and scripts can hold back the load event for a long
       time, so this waits for the frame's code, not for the event. The event
       still says when the address had no frame at all. */
    const ready = new Promise((resolve, reject) => {
      const limit = setTimeout(
        () => reject(Error("The frame did not load.")),
        LOAD_LIMIT_MS,
      );
      const poll = setInterval(() => {
        const win = frame.contentWindow;
        if (!win?.pairEmbed) return;
        clearInterval(poll);
        clearTimeout(limit);
        listen(win);
        resolve(win);
      }, POLL_MS);
      frame.addEventListener("load", () => {
        if (frame.contentDocument?.getElementById("app")) return;
        clearInterval(poll);
        clearTimeout(limit);
        reject(Error("The frame did not load."));
      });
    });
    ready.catch(() => {
      frame.remove();
      frames.delete(key);
    });
    frame.src = addressOf(row);
    host.append(frame);
    entry = { frame, ready };
    frames.set(key, entry);
    if (frames.size > KEPT) {
      const [oldest, gone] = frames.entries().next().value;
      gone.frame.remove();
      frames.delete(oldest);
    }
    return entry;
  }

  function reveal(entry) {
    if (shown === entry) return;
    for (const other of frames.values()) {
      other.frame.classList.toggle("is-shown", other === entry);
      other.frame.contentWindow?.pairEmbed?.show(other === entry);
    }
    shown = entry;
  }

  function hideShown() {
    shown?.frame.classList.remove("is-shown");
    shown = null;
  }

  async function open(row, query, mine) {
    clearTimeout(loadingTimer);
    const entry = load(row);
    // Another session's block must not sit under this result's title.
    if (shown !== entry) hideShown();
    loadingTimer = setTimeout(() => {
      if (mine !== turn) return;
      hideShown();
      onLoading(row);
    }, LOADING_AFTER_MS);
    try {
      const win = await entry.ready;
      if (mine !== turn) return;
      await win.pairEmbed.open(row, query);
      if (mine !== turn) return;
      clearTimeout(loadingTimer);
      reveal(entry);
      onShown(row);
    } catch {
      clearTimeout(loadingTimer);
      if (mine === turn) onFailed(row);
    }
  }

  function show(row, query, { now = false } = {}) {
    clearTimeout(restTimer);
    clearTimeout(loadingTimer);
    const mine = ++turn;
    if (!row) {
      hideShown();
      return onFailed(null);
    }
    if (now) void open(row, query, mine);
    else
      restTimer = setTimeout(
        () => open(row, query, mine),
        frames.has(keyOf(row)) ? REST_MS : LOAD_REST_MS,
      );
  }

  function pause() {
    for (const { frame } of frames.values())
      frame.contentWindow?.pairEmbed?.pause();
  }

  window.addEventListener("pair:theme", ({ detail }) => {
    for (const { frame } of frames.values())
      frame.contentWindow?.pairEmbed?.theme(detail);
  });

  return { show, pause };
}
