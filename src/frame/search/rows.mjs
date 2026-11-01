/* The modal's text: a row of the result list and its words. Nothing here touches
   the document, so a test can import it. */
const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (char) =>
    char === "&"
      ? "&amp;"
      : char === "<"
        ? "&lt;"
        : char === ">"
          ? "&gt;"
          : "&quot;",
  );
export { escapeHtml };

export const KINDS = [
  ["pages", "Pages"],
  ["threads", "Threads"],
  ["notes", "Notes"],
  ["answers", "Answers"],
  ["proposals", "Proposals"],
  ["agreed", "Agreed"],
];
const WIDER = {
  kinds: "every kind",
  rounds: "all rounds",
  sessions: "all sessions",
  closed: "closed sessions",
};

const icon = (paths) =>
  `<svg class="search-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const GLYPHS = {
  pages: icon('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
  threads: icon(
    '<path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.4-4.6a8 8 0 1 1 15.6-3.9z"/>',
  ),
  notes: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  answers: icon(
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M8 12l3 3 5-6"/>',
  ),
  proposals: icon(
    '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  ),
  agreed: icon(
    '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  ),
  code: icon('<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>'),
};

export function marked(text, ranges) {
  if (!ranges?.length) return escapeHtml(text);
  let html = "";
  let at = 0;
  for (const [start, end] of ranges) {
    html += `${escapeHtml(text.slice(at, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    at = end;
  }
  return html + escapeHtml(text.slice(at));
}

const SNIPPET_BEFORE = 28;
const SNIPPET_LENGTH = 220;

export function snippet(text, ranges) {
  if (!ranges?.length) return escapeHtml(text.slice(0, SNIPPET_LENGTH));
  const from = Math.max(0, ranges[0][0] - SNIPPET_BEFORE);
  const start = from === 0 ? 0 : text.indexOf(" ", from) + 1 || from;
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const inside = ranges
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]) => [a - start, b - start]);
  return (start ? "…" : "") + marked(text.slice(start, end), inside);
}

// A row stays the same result when a list is drawn again.
export const rowKey = (row) =>
  row &&
  JSON.stringify([row.session, row.round, row.page, row.block, row.item]);

const titleText = (row) => row.heading || row.pageTitle || "Untitled";
export const titleHtml = (row) =>
  marked(titleText(row), row.heading ? row.headingRanges : null);
// A heading's row has the heading as its text too, and its title already shows it.
export const hasOwnText = (row) =>
  Boolean(row.text) && row.text.trim() !== titleText(row).trim();

// The line ends with the session, the part an ellipsis can lose: a list of
// all sessions often repeats one name, and the round and page tell its rows apart.
export function whereLine(row, { allSessions }) {
  const parts = [];
  if (row.partial) parts.push(row.partial);
  if (row.draft) parts.push("Draft");
  if (row.from) parts.push(row.from === "reviewer" ? "You" : "Agent");
  if (row.round) parts.push(`Round ${row.round}`);
  if (row.pageTitle && row.pageTitle !== titleText(row))
    parts.push(row.pageTitle);
  if (row.also?.length) parts.push(`also in ${row.also.length} earlier`);
  if (row.closed) parts.push("Closed");
  if (allSessions) parts.push(row.sessionTitle);
  return parts.join(" · ");
}

export function rowHtml(row, index, { selected, sessions }) {
  return `<div class="search-row" id="search-row-${index}" role="option" data-i="${index}" aria-selected="${index === selected}">
    ${row.code ? GLYPHS.code : GLYPHS[row.kind]}
    <div>
      <div class="search-title">${titleHtml(row)}</div>
      ${hasOwnText(row) ? `<div class="search-snippet">${snippet(row.text, row.ranges)}</div>` : ""}
      <div class="search-where">${escapeHtml(whereLine(row, { allSessions: sessions.length !== 1 }))}</div>
    </div>
  </div>`;
}

// With nothing typed, the hub offers nothing to loosen, and its counts say what
// the kinds filter hides. Each step offers the next filter that is set.
function looser({ query, kinds, rounds, sessions }, { wider, counts }) {
  if (query.trim()) return wider;
  const hidden = Object.values(counts).reduce((a, b) => a + b, 0);
  if (kinds.length && hidden) return { filter: "kinds", total: hidden };
  if (rounds.length) return { filter: "rounds" };
  if (sessions.length) return { filter: "sessions" };
  return null;
}
function blankMessage({ query, kinds, rounds, sessions }) {
  const words = query.trim();
  if (words) return `No matches for “${escapeHtml(words)}” here.`;
  const where = !sessions.length
    ? "any session"
    : sessions.length === 1 && sessions[0] === "here"
      ? "this session"
      : "the chosen sessions";
  const when = !rounds.length
    ? ""
    : rounds.length === 1 && rounds[0] === "latest"
      ? "’s latest round"
      : "’s chosen rounds";
  const scope = `${where}${when}`;
  const chosen = KINDS.filter(([id]) => kinds.includes(id))
    .map(([, label]) => label.toLowerCase())
    .join(" or ");
  return chosen ? `No ${chosen} in ${scope}.` : `Nothing in ${scope} yet.`;
}
export function blankHtml(state, reply) {
  const offer = looser(state, reply);
  return `<div class="search-blank"><span>${blankMessage(state)}</span>${
    offer
      ? `<button class="btn" type="button" data-wider="${offer.filter}">Show ${offer.total ? `${offer.total} in ` : ""}${WIDER[offer.filter]}</button>`
      : ""
  }</div>`;
}
