import { $ } from "#frame/app/util.mjs";
import { session } from "#frame/app/view.mjs";
import { createMenus } from "#frame/search/menus.mjs";
import { openSearch, sharedWindow } from "#frame/search/modal.mjs";
import { escapeHtml, GLYPHS, HERE } from "#frame/search/rows.mjs";
import {
  GROUPS,
  KINDS,
  notificationRows,
  previewRow,
  rowHtml,
} from "#frame/search/notification-rows.mjs";
import { matchOf, pageOf, targetOf } from "#frame/search/open.mjs";
import {
  clear,
  listedSessions,
  loadCleared,
  openLine,
  toggleCenter,
  unreadEventIds,
  unreadCount,
} from "#frame/sync/center.mjs";
import { resultHref } from "#frame/sync/notifications.mjs";

/* Notifications' source for the shared window, and the read rules. A click reads
   a row at once. A key reads only the row the reader stays on, so ↓ through the
   list reads nothing. */
const STAY_MS = 1500;
const SEARCH_LIMIT = 500;
const BELL_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>';
const FAILED = "Search could not reach the hub.";

const state = {
  query: "",
  sessions: [],
  kinds: [],
  states: [],
  selected: -1,
  row: null,
};
// threadLines is the last answer of /api/notifications. Until it arrives after an
// open, the list has only the bell's rows, the ones the hub's answer can't change.
let threadLines = {};
let answered = false;
// A row keeps the group and the place it had when the window opened or a menu last
// changed, so a row just read doesn't jump. Marks and the count read the live state.
let kept = new Map();
// hits maps a row's key to the search result that found it.
let hits = new Map();
let searching = false;
let searchFailed = false;
let linesFailed = false;
let stay = 0;
// A failed poll lists no sessions, and the page in the pane can still be in use, so
// the window keeps showing the last sessions it had.
let sessions = [];
const liveSessions = () => {
  if (listedSessions().length) sessions = listedSessions();
  return sessions;
};
// replied maps a thread to the message the reader just sent from the pane, until
// the hub's lines have it.
const replied = new Map();

const hereIs = (id) => (id === HERE ? session.sessionId : id);
const terms = () => state.query.toLowerCase().split(/\s+/).filter(Boolean);

function linesWithReplies() {
  if (!replied.size) return threadLines;
  const merged = {};
  for (const [id, { threads, proposals }] of Object.entries(threadLines))
    merged[id] = {
      proposals,
      threads: threads.map((line) => {
        const sent = replied.get(line.thread);
        if (!sent) return line;
        if (line.message > sent.message) {
          replied.delete(line.thread);
          return line;
        }
        const { answeredAt, ...rest } = line;
        return {
          ...rest,
          text: sent.text,
          at: sent.at,
          waitingSince: sent.at,
          readAt: null,
        };
      }),
    };
  return merged;
}
function liveRows() {
  const rows = notificationRows(
    liveSessions(),
    linesWithReplies(),
    loadCleared(),
    session.sessionId,
  );
  return answered
    ? rows
    : rows.filter((row) => row.state === "unread" || kept.has(row.key));
}
const liveRow = (key) => liveRows().find((row) => row.key === key);

function matches(row) {
  const words = terms();
  if (!words.length || hits.has(row.key)) return true;
  // The hub may still find the selected row, so it stays selected until it answers.
  if (searching && row.key === state.row) return true;
  const text = [row.words, row.sessionTitle, row.pageTitle ?? ""]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}
function passes(row, skip) {
  const chosen = state.sessions.map(hereIs);
  if (skip !== "sessions" && chosen.length && !chosen.includes(row.session))
    return false;
  if (skip !== "kinds" && state.kinds.length && !state.kinds.includes(row.kind))
    return false;
  if (
    skip !== "states" &&
    state.states.length &&
    !state.states.includes(kept.get(row.key).group)
  )
    return false;
  return matches(row);
}
const rank = (group) => GROUPS.findIndex(([id]) => id === group);
const groupName = (group) => GROUPS.find(([id]) => id === group)[1];
function snapshot() {
  const rows = liveRows();
  for (const row of rows)
    if (!kept.has(row.key)) kept.set(row.key, { group: row.state, at: row.at });
  const place = (row) => kept.get(row.key);
  const shown = rows
    .filter((row) => passes(row))
    .sort(
      (a, b) =>
        rank(place(a).group) - rank(place(b).group) ||
        place(b).at.localeCompare(place(a).at),
    );
  const counts = {};
  for (const [id] of KINDS)
    counts[id] = rows.filter(
      (row) => passes(row, "kinds") && row.kind === id,
    ).length;
  for (const [id] of GROUPS)
    counts[id] = rows.filter(
      (row) => passes(row, "states") && row.state === id,
    ).length;
  let group = null;
  const results = shown.map((row) => {
    const own = place(row).group;
    const first = own !== group;
    group = own;
    return {
      ...row,
      hit: hits.get(row.key),
      head: first ? groupName(own) : "",
      clearAll: first && own === "unread" && unreadCount() > 0,
    };
  });
  return { results, counts, total: results.length };
}

async function readLines(signal) {
  try {
    const reply = await fetch("/api/notifications", { signal });
    if (!reply.ok) throw Error("The hub refused the notifications.");
    threadLines = (await reply.json()).sessions;
    linesFailed = false;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    linesFailed = true;
  }
  answered = true;
}
// The frame can't search on its own, because the poll has no thread text. The
// route gives one result per message, ranked, so the first per thread is its best.
async function readHits(signal) {
  const params = new URLSearchParams({
    q: state.query,
    kinds: "threads,proposals",
    limit: String(SEARCH_LIMIT),
  });
  if (state.sessions.length)
    params.set("session", state.sessions.map(hereIs).join(","));
  const reply = await fetch(`/api/search?${params}`, { signal });
  if (!reply.ok) throw Error("Search failed.");
  const found = new Map();
  for (const hit of (await reply.json()).results) {
    const key =
      hit.kind === "threads"
        ? `thread:${hit.item.split("/")[0]}`
        : `proposal:${hit.session}:${hit.item}`;
    if (!found.has(key)) found.set(key, hit);
  }
  return found;
}

function markRead(row) {
  clearTimeout(stay);
  clear(row.events);
}
// The close event comes after Open has started landing on the page, which takes
// the focus, so the window hands it back to the bell only when nothing was opened.
let landing = false;
function openRow(row) {
  landing = true;
  markRead(row);
  const shown = previewRow(row);
  const page = pageOf(shown);
  const target = targetOf(shown);
  const match = matchOf(shown, state.query);
  openLine({
    entry: { id: row.session, url: row.url, round: row.sessionRound },
    page,
    round: shown.round ?? undefined,
    target,
    match,
    // A session start opens the session where the reviewer last was.
    href:
      row.kind === "session"
        ? row.url
        : resultHref({ ...shown, page }, { target, match }),
  });
}

const emptyPane = () => {
  const glyph = GLYPHS.threads;
  const mark = (state, words) =>
    `<li class="is-${state}"><span class="nt-glyph">${glyph}<i class="nt-mark"></i></span>${words}</li>`;
  return `<div class="nt-empty">
    <p>Choose a row to read it here.</p>
    <ul>
      ${mark("unread", "Unread. The bell counts these.")}
      ${mark("waiting", "Waiting on the agent.")}
      ${mark("read", "Read, or cleared.")}
    </ul>
    <p><kbd>↑</kbd> <kbd>↓</kbd> move, <kbd>↵</kbd> opens the page.</p>
  </div>`;
};
const failed = () => searchFailed || linesFailed;
function blank() {
  const typed = state.query.trim();
  const words = typed
    ? `No notifications match “${escapeHtml(typed)}”.`
    : state.states.length === 1 && state.states[0] === "unread"
      ? "Nothing unread."
      : "No notifications here.";
  return `<div class="search-blank"><span>${words}</span>${
    typed
      ? `<button class="btn" type="button" data-search-all>Search all of pair for “${escapeHtml(typed)}”</button>`
      : ""
  }${failed() ? `<span>${FAILED}</span>` : ""}</div>`;
}

let source = null;
function notificationsSource(win) {
  const menus = createMenus({
    host: win.part(".search-filters"),
    state,
    names: ["sessions", "kinds", "states"],
    counted: ["kinds", "states"],
    items: {
      sessions: () => [
        ["", "All sessions"],
        [HERE, "This session"],
        null,
        ...liveSessions()
          .filter(({ id, closed }) => !closed && id !== session.sessionId)
          .map(({ id, title }) => [id, title]),
      ],
      kinds: () => [["", "All kinds"], ...KINDS],
      states: () => [["", "All states"], ...GROUPS],
    },
    labels: {
      sessions: ([only]) =>
        only === HERE
          ? "This session"
          : (liveSessions().find(({ id }) => id === only)?.title ??
            "1 session"),
      kinds: ([only]) => KINDS.find(([id]) => id === only)?.[1],
      states: ([only]) => GROUPS.find(([id]) => id === only)?.[1],
    },
  });
  return {
    label: "Notifications",
    listLabel: "Notifications",
    placeholder: "Search notifications",
    glyph: BELL_GLYPH,
    focusField: false,
    selectFirst: false,
    state,
    menus,
    empty: emptyPane(),
    snapshot,
    // While the request runs, the rows the frame matched show, and the hub's rows
    // join when it answers.
    async load(signal, early) {
      hits = new Map();
      searchFailed = false;
      searching = Boolean(state.query.trim());
      early(snapshot());
      if (!answered) {
        await readLines(signal);
        early(snapshot());
      }
      if (searching)
        try {
          hits = await readHits(signal);
        } catch (error) {
          if (error.name === "AbortError") throw error;
          searchFailed = true;
        }
      searching = false;
      return snapshot();
    },
    rowKey: (row) => row?.key,
    rowHtml,
    blank,
    end: () => (failed() ? `<div class="search-end">${FAILED}</div>` : ""),
    count: () => (unreadCount() ? `${unreadCount()} unread` : ""),
    preview: previewRow,
    open: openRow,
    onShow(row, how) {
      clearTimeout(stay);
      if (row.state !== "unread") return;
      if (how === "click") return markRead(row);
      stay = setTimeout(() => {
        if (state.row !== row.key) return;
        const live = liveRow(row.key);
        if (live?.state === "unread") markRead(live);
      }, STAY_MS);
    },
    act(target) {
      if (target.closest("[data-clear-all]")) {
        clear(unreadEventIds());
        return true;
      }
      if (target.closest("[data-search-all]")) {
        openSearch(state.query.trim());
        return true;
      }
      const clearOne = target.closest(".nt-act");
      if (!clearOne) return false;
      markRead(win.rowAt(Number(clearOne.closest(".nt-row").dataset.i)));
      return true;
    },
    keys: {},
    commandK: () => openSearch(state.query.trim()),
    onFilter() {
      kept = new Map();
    },
    onClose() {
      clearTimeout(stay);
    },
    returnFocus() {
      const leaving = landing;
      landing = false;
      return leaving ? null : $("bell");
    },
  };
}

// A thread the reader answered in the pane shows their words and Not opened at
// once, and its replies leave the bell.
function repliedInPane({ detail }) {
  const win = sharedWindow();
  if (!win || win.showing() !== source) return;
  const row = liveRow(`thread:${detail.thread}`);
  if (!row) return;
  replied.set(detail.thread, {
    text: detail.text,
    at: new Date().toISOString(),
    message: row.message,
  });
  clear(row.events);
  win.refresh();
}
// A card the reader decided in the pane shows its state word at once.
function cardChanged() {
  refreshNotifications(true);
}

// The bell opens the window with nothing selected, or at the row it was given.
export function openNotifications(key = null) {
  const win = sharedWindow();
  if (!win) return;
  toggleCenter(false);
  if (!source) {
    source = notificationsSource(win);
    window.addEventListener("pair:reply", repliedInPane);
    window.addEventListener("pair:card", cardChanged);
  }
  Object.assign(state, {
    query: "",
    sessions: [],
    kinds: [],
    states: [],
    selected: -1,
    row: null,
  });
  threadLines = {};
  answered = false;
  kept = new Map();
  hits = new Map();
  searching = false;
  searchFailed = false;
  linesFailed = false;
  replied.clear();
  win.open(source, { select: key });
}

// renderCenter calls this each time the bell changes, and fromHub is true on each
// poll, when the lines may have changed too.
export function refreshNotifications(fromHub) {
  const win = sharedWindow();
  if (!win || !source || win.showing() !== source) return;
  win.refresh();
  if (fromHub && answered)
    void readLines().then(() => {
      if (win.showing() === source) win.refresh();
    });
}
