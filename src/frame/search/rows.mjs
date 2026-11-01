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

export function whereLine(row, { allSessions }) {
  const parts = [];
  if (row.partial) parts.push(row.partial);
  if (row.draft) parts.push("Draft");
  if (row.from) parts.push(row.from === "reviewer" ? "You" : "Agent");
  if (allSessions) parts.push(row.sessionTitle);
  if (row.round) parts.push(`Round ${row.round}`);
  if (row.pageTitle && row.pageTitle !== row.heading) parts.push(row.pageTitle);
  if (row.also?.length) parts.push(`also in ${row.also.length} earlier`);
  return parts.join(" · ");
}
