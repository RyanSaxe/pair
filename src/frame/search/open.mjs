import { base, session } from "#frame/app/view.mjs";
import { isLetter } from "#frame/notes/match.mjs";
import { openLine } from "#frame/sync/center.mjs";
import { resultHref } from "#frame/sync/notifications.mjs";
import { remote } from "#frame/sync/rounds.mjs";

// The element on the result's page that holds it.
export function targetOf(row) {
  // A page title's result is the page itself, from its title down.
  if (row.type === "page title") return null;
  if (row.kind === "threads") {
    const [thread, message] = row.item.split("/");
    return `thread-${thread}-${message}`;
  }
  if (row.type === "alignment") return `agreement-${row.item}`;
  if (row.type === "task") return "agreement-task";
  if (row.kind === "proposals") return `proposal-${row.item}`;
  if (row.draft) return null;
  if (row.kind === "notes" || row.kind === "answers") return `sent-${row.item}`;
  // A block with its own id keeps it, so the hub says which id it has.
  return (
    row.blockId ??
    (Number.isInteger(row.block) ? `block-${row.page}-${row.block}` : null)
  );
}

// A note, answer or choice shows on its round's Feedback or Review page.
export const pageOf = (row) =>
  row.draft || row.kind === "notes" || row.kind === "answers"
    ? "feedback"
    : row.page;

function wordAround(text, from, to) {
  while (isLetter(text[from - 1])) from--;
  while (isLetter(text[to])) to++;
  return text.slice(from, to);
}

/* The words to mark on the result's page: what the reader typed, and the word
   around each mark of the row that they didn't type, such as the word a typo
   found. A mark can be only some of a word's letters. The hub clips a block's
   text, so a typed word can be on the page with no mark in the row, and the
   marks add to the typed words instead of replacing them. */
export function matchOf(row, query) {
  const typed = query.trim();
  const phrase = typed.toLowerCase().replace(/\s+/g, " ");
  const spelled = new Set([phrase, ...phrase.split(" ")]);
  const found = new Set();
  for (const [text, ranges] of [
    [row.text, row.ranges],
    [row.heading, row.headingRanges],
  ])
    for (const [from, to] of ranges)
      if (!spelled.has(text.slice(from, to).toLowerCase()))
        found.add(wordAround(text, from, to));
  return [typed, ...found].join(" ");
}

export function openResult(row, query, place = {}) {
  const page = place.page ?? pageOf(row);
  const target = place.target ?? targetOf(row);
  const match = matchOf(row, query);
  const href = resultHref({ ...row, page }, { target, match });
  if (!row.round) return location.assign(href);
  const own = row.session === session.sessionId;
  openLine({
    entry: own
      ? {
          id: session.sessionId,
          url: `${base}/`,
          round: remote?.current?.round,
        }
      : { id: row.session },
    page,
    round: row.round,
    target,
    match,
    href,
  });
}
