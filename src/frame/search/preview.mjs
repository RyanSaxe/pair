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
// Longer than a press on a button lasts, and about as long as a keyboard takes to
// drop.
const LEAVE_REST_MS = 300;
const LOAD_LIMIT_MS = 60000;
const POLL_MS = 20;

const keyOf = (row) =>
  row.closed && row.round ? `${row.session}|${row.round}` : row.session;
const addressOf = (row) =>
  `/s/${row.session}/embed/${row.closed && row.round ? encodeURIComponent(row.round) : "latest"}`;
// The field with focus that takes typing, which leaves out a checkbox or a
// button. A closed dialog's field can hold focus for a moment after it closes.
const fieldIn = ({ activeElement: active }) =>
  active?.matches(":read-write") && active.checkVisibility() ? active : null;

export function createPreview({
  host,
  onShown,
  onFailed,
  onLoading,
  onKey,
  onFocus,
}) {
  const frames = new Map();
  let shown = null;
  let restTimer = 0;
  let turn = 0;
  const bar = document.createElement("div");
  bar.className = "search-progress";
  host.append(bar);
  const loading = (on) => host.classList.toggle("is-loading", on);

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
    win.addEventListener("focusin", () => {
      if (fieldIn(win.document)) onFocus();
    });
    // A press on a button takes the focus before its click, and the click misses
    // the button if the frame moves first.
    win.addEventListener("focusout", () => setTimeout(onFocus, LEAVE_REST_MS));
    // The close event doesn't bubble, and a dialog closes with no focus change
    // when the control that opened it has gone.
    win.addEventListener("close", onFocus, true);
    // A shorter frame can leave the field below its fold, or the fold of the
    // note's scrolling body.
    win.addEventListener("resize", () => {
      if (host.closest(".is-writing"))
        fieldIn(win.document)?.scrollIntoView({
          block: "nearest",
          behavior: "instant",
        });
    });
  }

  // The frame keeps its active element after the focus leaves it for the modal.
  function writing() {
    const frame = shown?.frame;
    return (
      frame === document.activeElement &&
      Boolean(fieldIn(frame.contentDocument))
    );
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
    entry.frame.classList.remove("is-stale");
    if (shown === entry) return;
    for (const other of frames.values()) {
      other.frame.classList.remove("is-stale");
      other.frame.classList.toggle("is-shown", other === entry);
      other.frame.contentWindow?.pairEmbed?.show(other === entry);
    }
    shown = entry;
  }

  function hideShown() {
    shown?.frame.classList.remove("is-shown", "is-stale");
    shown = null;
  }

  /* What's on screen stays, and dims if the wait is long, until the new result
     has drawn and moved to its words, so it arrives whole. */
  async function open(row, query, mine) {
    const entry = load(row);
    try {
      const win = await entry.ready;
      if (mine !== turn) return;
      await win.pairEmbed.open(row, query);
      if (mine !== turn) return;
      loading(false);
      reveal(entry);
      onShown(row);
    } catch {
      if (mine !== turn) return;
      loading(false);
      hideShown();
      onFailed(row);
    }
  }

  function show(row, query, { now = false } = {}) {
    clearTimeout(restTimer);
    const mine = ++turn;
    shown?.frame.classList.add("is-stale");
    if (!row) {
      loading(false);
      hideShown();
      return onFailed(null);
    }
    loading(true);
    onLoading();
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

  return { show, pause, writing };
}
