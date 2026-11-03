import { since } from "#frame/app/time.mjs";
import { cardState } from "#frame/pages/work.mjs";
import { escapeHtml, GLYPHS, marked, snippet } from "#frame/search/rows.mjs";
import { bellLines } from "#frame/sync/center.mjs";
import { eventTitle } from "#frame/sync/notifications.mjs";

/* What the bell and the Notifications window say about each row. Nothing here
   touches the document, so a test can import it. A row is one thread, round,
   proposal or session start. */
export const GROUPS = [
  ["unread", "Unread"],
  ["waiting", "Waiting on the agent"],
  ["read", "Read"],
];
export const KINDS = [
  ["thread", "Threads"],
  ["round", "Rounds"],
  ["proposal", "Proposals"],
  ["session", "Sessions"],
];
const GLYPH_OF = {
  thread: "threads",
  round: "pages",
  proposal: "proposals",
  session: "sessions",
};
export const glyphOf = (row) => GLYPHS[GLYPH_OF[row.kind]];
const WAITING_FOR_START = "Waiting for Start";

const KEY_OF = {
  reply: (entry, event) => `thread:${event.thread}`,
  waiting: (entry, event) => `round:${entry.id}:${event.round}`,
  proposal: (entry, event) => `proposal:${entry.id}:${event.proposal}`,
  session: (entry, event) => `session:${entry.id}:${event.id}`,
};
const KIND_OF = {
  reply: "thread",
  waiting: "round",
  proposal: "proposal",
  session: "session",
};
const roundWaits = (entry, event) =>
  entry.needsYou && entry.round === event.round;
function eventWords(entry, event) {
  if (event.kind === "reply") return event.words ?? eventTitle(event);
  if (event.kind === "proposal") return `Proposal: ${event.name}`;
  if (event.kind === "waiting" && !roundWaits(entry, event))
    return `Round ${event.round} published`;
  return eventTitle(event);
}
// A row's fields, from the newest event of its thread, round, proposal or session
// start.
function eventRow(entry, event, state, thisId) {
  return {
    key: KEY_OF[event.kind](entry, event),
    kind: KIND_OF[event.kind],
    state,
    words: eventWords(entry, event),
    at: event.at,
    count: 1,
    session: entry.id,
    sessionTitle: entry.title,
    sessionRound: entry.round,
    url: entry.url,
    own: entry.id === thisId,
    events: [event.id],
    ...(event.kind === "reply"
      ? {
          thread: event.thread,
          message: event.message,
          proposal: event.proposal,
          round: event.round,
          page: event.page,
          pageTitle: event.name,
        }
      : {}),
    ...(event.kind === "waiting" ? { round: event.round, page: "agreed" } : {}),
    ...(event.kind === "session" ? { page: "agreed" } : {}),
    ...(event.kind === "proposal"
      ? {
          proposal: event.proposal,
          page: "work",
          pageTitle: event.name,
          status: WAITING_FOR_START,
        }
      : {}),
  };
}

// One row per thread, however many of its replies are new, with every event's ID,
// so clearing the row clears them all. lines is the list from bellLines, newest
// first. Every count of unread things comes from these rows, so none can differ.
export function bellRows(lines, thisId) {
  const rows = new Map();
  const replies = new Map();
  for (const event of lines) {
    const key = KEY_OF[event.kind](event.entry, event);
    if (rows.has(key)) rows.get(key).events.push(event.id);
    else rows.set(key, eventRow(event.entry, event, "unread", thisId));
    replies.set(key, new Set(replies.get(key)).add(event.message));
    rows.get(key).count = replies.get(key).size;
  }
  return [...rows.values()];
}

// What the card's own line says, and Proposed reads Waiting for Start here.
function statusOf(card, sessions) {
  const [word] = cardState(card, {
    unread: new Set(),
    linked: (id) => sessions.find((entry) => entry.id === id) ?? null,
  });
  return word === "Proposed" ? WAITING_FOR_START : word;
}
function threadRow(line, entry, thisId) {
  return {
    key: `thread:${line.thread}`,
    kind: "thread",
    state: line.waitingSince ? "waiting" : "read",
    words: line.text,
    at: line.at,
    count: 1,
    session: entry.id,
    sessionTitle: entry.title,
    sessionRound: entry.round,
    url: entry.url,
    own: entry.id === thisId,
    events: [],
    thread: line.thread,
    message: line.message,
    proposal: line.proposal,
    round: line.round,
    page: line.page,
    pageTitle: line.name,
    opened: Boolean(line.readAt),
  };
}

// Every row of the live sessions. The unread rows are bellRows. A thread line with
// waitingSince is waiting, and every other row is read. threadLines is the answer
// of /api/notifications, by session. Before it arrives, a thread the reviewer just
// read still has a row, from its events.
export function notificationRows(sessions, threadLines, cleared, thisId) {
  const unread = bellRows(bellLines(sessions, cleared, thisId), thisId);
  const rows = new Map(unread.map((row) => [row.key, row]));
  for (const entry of sessions) {
    if (entry.closed) continue;
    const listed = threadLines[entry.id] ?? { threads: [], proposals: [] };
    for (const line of listed.threads) {
      const row = threadRow(line, entry, thisId);
      if (!rows.has(row.key)) rows.set(row.key, row);
    }
    const newest = [...(entry.events || [])].sort((a, b) =>
      b.at.localeCompare(a.at),
    );
    for (const event of newest) {
      if (!KEY_OF[event.kind]) continue;
      const key = KEY_OF[event.kind](entry, event);
      if (!rows.has(key)) rows.set(key, eventRow(entry, event, "read", thisId));
    }
    for (const card of listed.proposals) {
      const row = rows.get(`proposal:${entry.id}:${card.id}`);
      if (row) row.status = statusOf(card, sessions);
    }
  }
  return [...rows.values()];
}

// The row's second line, up to its time.
export function whereText(row) {
  const place =
    row.kind === "thread" && row.own ? row.pageTitle : row.sessionTitle;
  if (row.kind === "thread") {
    if (row.state === "waiting")
      return `${row.opened ? "Read, no reply" : "Not opened"} · ${place}`;
    return row.state === "unread" && row.count > 1
      ? `${place} · ${row.count} replies`
      : place;
  }
  if (row.kind === "proposal") return `${row.status} · ${place}`;
  return place;
}

// Where the page in the right pane goes for a row. It has the fields of a search
// result, because the frame goes to both the same way, and matchOf needs the empty
// arrays.
export function previewRow(row) {
  const base = {
    session: row.session,
    sessionTitle: row.sessionTitle,
    pageTitle: row.pageTitle,
    text: "",
    ranges: [],
    heading: "",
    headingRanges: [],
  };
  if (row.kind === "thread")
    return {
      ...base,
      kind: "threads",
      item: `${row.thread}/${row.message}`,
      round: row.round,
      page: row.page,
    };
  if (row.kind === "proposal")
    return { ...base, kind: "proposals", item: row.proposal, page: "work" };
  return {
    ...base,
    kind: "pages",
    type: "page title",
    page: "agreed",
    round: row.round ?? row.sessionRound,
    heading: row.words,
  };
}

export function rangesIn(text, words) {
  const low = text.toLowerCase();
  const found = [];
  for (const word of words) {
    let at = low.indexOf(word);
    while (at >= 0) {
      found.push([at, at + word.length]);
      at = low.indexOf(word, at + word.length);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
// The letters of a search result that its marks cover, such as the word a typo
// found.
const hitWords = (hit) =>
  (hit?.ranges ?? []).map(([from, to]) =>
    hit.text.slice(from, to).toLowerCase(),
  );
// About as much of a row's first line as fits in the window's list.
const SHOWN_LENGTH = 44;
// A match the row doesn't show gets a line of its own, with the words marked.
function matchLine(row, words) {
  if (!row.hit?.ranges?.length) return "";
  const shown = row.words.slice(0, SHOWN_LENGTH).toLowerCase();
  const found = hitWords(row.hit);
  if ((found.length ? found : words).every((word) => shown.includes(word)))
    return "";
  return `<div class="search-snippet">${snippet(row.hit.text, row.hit.ranges)}</div>`;
}
const STATE_WORDS = Object.fromEntries(GROUPS);
export function rowHtml(row, index, { selected, query = "" }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const ranges = rangesIn(row.words, [...words, ...hitWords(row.hit)]);
  const action =
    row.state === "unread"
      ? `<button class="icon-btn nt-act" type="button" aria-label="Clear" title="Clear">✕</button>`
      : "";
  const head = row.head
    ? `<div class="search-group"><span>${row.head}</span>${row.clearAll ? '<button class="link-btn nt-clear-all" type="button" data-clear-all>Clear all</button>' : ""}</div>`
    : "";
  return `${head}<div class="search-row nt-row is-${row.state}" id="search-row-${index}" role="option" data-i="${index}" aria-selected="${index === selected}" aria-label="${STATE_WORDS[row.state]}: ${escapeHtml(row.words.slice(0, 80))}">
    <span class="nt-glyph" title="${STATE_WORDS[row.state]}">${glyphOf(row)}<i class="nt-mark"></i></span>
    <div>
      <div class="search-title">${marked(row.words, ranges)}</div>
      ${matchLine(row, words)}
      <div class="search-where"><span>${escapeHtml(whereText(row))}</span><span class="nt-when">${since(row.at)}</span></div>
    </div>
    ${action}
  </div>`;
}
