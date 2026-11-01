import { base, session } from "#frame/app/view.mjs";
import { openLine } from "#frame/sync/center.mjs";
import { resultHref } from "#frame/sync/notifications.mjs";
import { remote } from "#frame/sync/rounds.mjs";

// The element on the result's page that holds it.
export function targetOf(row) {
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

// A sent note, answer or choice shows on its round's Feedback page.
export const pageOf = (row) =>
  !row.draft && (row.kind === "notes" || row.kind === "answers")
    ? "feedback"
    : row.page;

export function openResult(row, query) {
  const page = pageOf(row);
  const target = targetOf(row);
  const match = query.trim();
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
