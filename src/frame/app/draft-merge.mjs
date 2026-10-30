import { itemKey, splitKey } from "#shared/draft-items.mjs";

const record = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const emptySynced = () => ({ revision: 0, items: {} });

// The frame keeps a digest of each synced item in localStorage instead of
// the item, because a drawing's scene can be large and a full copy would
// double the draft. digest sorts object keys first, so it returns the same
// string for two copies of an item whose fields are in a different order.
export function digest(value) {
  const text = JSON.stringify(value ?? null, (key, item) =>
    record(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + "." + (h1 >>> 0).toString(36);
}
const none = digest(null);

/* draftItems leaves out every item that a submission from this browser
   sent, and every checklist that the reviewer never touched. The frame
   builds an untouched checklist from the page in each browser, so sending
   it would replace a checklist the reviewer changed on another device. */
export function draftItems(draft) {
  const items = {};
  for (const note of draft.notes)
    if (!note.sentIn) items[itemKey("note", note.id)] = note;
  for (const [key, choice] of Object.entries(draft.choices))
    if (!choice.sentIn && (choice.kind !== "multiple" || choice.touched))
      items[itemKey("choice", key)] = choice;
  for (const [key, answer] of Object.entries(draft.answers))
    if (!answer.sentIn) items[itemKey("answer", key)] = answer;
  for (const [kind, field] of [
    ["draft", "drafts"],
    ["noteDraft", "noteDrafts"],
    ["replyDraft", "replyDrafts"],
  ])
    for (const [key, value] of Object.entries(draft[field] || {}))
      items[itemKey(kind, key)] = value;
  if (draft.message) items.message = draft.message;
  if (draft.alignUnflagged === false) items.alignUnflagged = false;
  return items;
}

// draftChanges returns each item whose value differs from the hub's value at
// the last merge, with null for an item the reviewer removed.
export function draftChanges(draft) {
  const items = draftItems(draft);
  const synced = draft.synced.items;
  const changes = {};
  for (const key of new Set([...Object.keys(items), ...Object.keys(synced)]))
    if (digest(items[key]) !== (synced[key]?.digest ?? none))
      changes[key] = items[key] ?? null;
  return changes;
}

// forgetSent deletes the synced record of each item that markSent() just
// marked as sent, so draftChanges() does not send a removal for it. The hub
// removes the sent items itself when it saves the submission.
// recordPushed records the hub's value for each item that this browser just
// sent and the hub kept. Without the record, a later removal here would match
// the last merge, so draftChanges() would not send it, and the next merge
// would bring the item back.
export function recordPushed(draft, changes, hub) {
  for (const [key, value] of Object.entries(changes)) {
    const item = hub.items[key];
    const known = draft.synced.items[key];
    if (!item || (known && item.rev <= known.rev)) continue;
    if (digest(item.value) === digest(value))
      draft.synced.items[key] = { rev: item.rev, digest: digest(value) };
  }
}
export function forgetSent(draft, before) {
  const after = draftItems(draft);
  for (const key of Object.keys(before))
    if (!(key in after)) delete draft.synced.items[key];
}

const fields = {
  choice: "choices",
  answer: "answers",
  draft: "drafts",
  noteDraft: "noteDrafts",
  replyDraft: "replyDrafts",
};
function sentHere(draft, kind, id) {
  if (kind === "note")
    return Boolean(draft.notes.find((note) => note.id === id)?.sentIn);
  if (kind === "choice") return Boolean(draft.choices[id]?.sentIn);
  // A typed answer under a sent answer's key is part of the sent round.
  if (kind === "answer" || kind === "draft")
    return Boolean(draft.answers[id]?.sentIn);
  return false;
}
function apply(draft, kind, id, value) {
  if (kind === "message") draft.message = value ?? "";
  else if (kind === "alignUnflagged") draft.alignUnflagged = value ?? true;
  else if (kind === "note") {
    const index = draft.notes.findIndex((note) => note.id === id);
    if (value === null) {
      if (index >= 0) draft.notes.splice(index, 1);
    } else if (index >= 0) draft.notes[index] = value;
    else draft.notes.push(value);
  } else {
    const map = (draft[fields[kind]] ||= {});
    if (value === null) delete map[id];
    else map[id] = value;
  }
}

/* mergeDraft applies the hub's draft to this browser's draft and returns
   whether any value here changed. For each item the hub changed since the
   last merge, the hub's value replaces this browser's value, unless the
   reviewer changed the item here since the last merge. That change has not
   reached the hub yet, so the hub will receive it later and keep it. A
   note's tombstone replaces even a change made here, because the hub refuses
   to bring a deleted note back. mergeDraft never changes an item that this
   browser sent. With hold, mergeDraft only records the items whose value
   here already matches the hub's, so the frame does not replace text that
   the reviewer is typing. */
export function mergeDraft(draft, hub, { hold = false } = {}) {
  if (hub.revision < draft.synced.revision) draft.synced = emptySynced();
  const synced = draft.synced.items;
  const local = draftItems(draft);
  let changed = false;
  for (const [key, item] of Object.entries(hub.items)) {
    const known = synced[key];
    const parts = splitKey(key);
    if (!parts || (known && item.rev <= known.rev)) continue;
    if (sentHere(draft, parts.kind, parts.id)) continue;
    const theirs = digest(item.value);
    const mine = digest(local[key]);
    const finalDelete = parts.kind === "note" && item.value === null;
    if (mine === theirs) {
      // draftItems() counts an untouched checklist as no item, and a
      // tombstone for its key means that another browser sent that
      // checklist.
      if (
        item.value === null &&
        parts.kind === "choice" &&
        draft.choices[parts.id]
      ) {
        if (hold) continue;
        delete draft.choices[parts.id];
        changed = true;
      }
    } else {
      if (hold) continue;
      if (mine !== (known?.digest ?? none) && !finalDelete) continue;
      apply(draft, parts.kind, parts.id, structuredClone(item.value));
      changed = true;
    }
    synced[key] = { rev: item.rev, digest: theirs };
  }
  draft.synced.revision = Math.max(draft.synced.revision, hub.revision);
  return changed;
}
