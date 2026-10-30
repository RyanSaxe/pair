import crypto from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sentItems, splitKey } from "../../shared/draft-items.mjs";
import { atomic, read, requireValue } from "../../shared/util.mjs";

const record = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value, keys) =>
  record(value) && keys.every((key) => typeof value[key] === "string");
const shapes = {
  note: (value, id) =>
    strings(value, ["id", "topic", "anchor", "text"]) && value.id === id,
  choice: (value) => strings(value, ["topic"]),
  answer: (value) => strings(value, ["topic"]),
  alignUnflagged: (value) => typeof value === "boolean",
};
const valid = (key, value) => {
  const parts = splitKey(key);
  return (
    key.length <= 2000 &&
    Boolean(parts) &&
    (value === null || shapes[parts.kind](value, parts.id))
  );
};

/* The hub orders changes by when it receives them, not by a device's clock,
   because a phone's clock and a computer's can differ. applyChanges gives
   each change the next revision, and the later revision wins. applyChanges
   stores a deleted item as a tombstone, a null value, so the frame on a
   device that still has the item drops it. applyChanges ignores every
   change to a note after its tombstone, so a device that has not merged the
   delete yet cannot bring the note back. */
export function applyChanges(draft, changes) {
  const items = { ...draft.items };
  let revision = draft.revision;
  for (const [key, value] of Object.entries(changes)) {
    const item = items[key];
    if (item && isDeepStrictEqual(item.value, value)) continue;
    if (item?.value === null && key.startsWith("note/")) continue;
    items[key] = { rev: ++revision, value };
  }
  return { ...draft, revision, items };
}

/* applySubmission removes the items in a submission, as markSent() does in
   the browser that sent it. It keeps an item that another device changed
   after the sending browser last merged the draft, because the submission
   did not include that change, so the reviewer can still send it.
   initializeChecklists() rebuilds a checklist with the current round, and a
   draft saved by an older frame has another ID as a checklist's target, so
   applySubmission compares items without their target and round. */
const content = ({ target, round, ...rest }) => rest;
export function applySubmission(draft, payload) {
  const removed = {};
  for (const [key, sent] of sentItems(payload)) {
    const value = draft.items[key]?.value ?? null;
    if (value === null || isDeepStrictEqual(content(value), content(sent)))
      removed[key] = null;
  }
  return applyChanges(draft, removed);
}

/* The draft's id names this copy of draft.json. When the file is missing or
   unreadable, or was written before the hub kept only completed items, the
   hub starts an empty draft with a new id. The frame then forgets which of
   its items it had synced and sends each one again. */
export async function draftStore(session) {
  const file = path.join(session.directory, "draft.json");
  let draft = { id: crypto.randomUUID(), revision: 0, items: {} };
  try {
    const saved = await read(file);
    if (
      typeof saved.id === "string" &&
      Number.isInteger(saved.revision) &&
      record(saved.items)
    )
      draft = saved;
  } catch {
    /* The empty draft above stands. */
  }
  const keep = async (next) => {
    if (next.revision === draft.revision) return draft;
    await atomic(file, next);
    draft = next;
    return draft;
  };
  return {
    draftView: () => draft,
    async changeDraft(data) {
      requireValue(
        session.state.stage !== "complete",
        "This session is closed",
        409,
      );
      requireValue(
        record(data) &&
          record(data.changes) &&
          Object.entries(data.changes).every(([key, value]) =>
            valid(key, value),
          ),
        "Send changes as an object of draft item keys and values.",
      );
      return keep(applyChanges(draft, data.changes));
    },
    draftSent: (payload) => keep(applySubmission(draft, payload)),
  };
}
