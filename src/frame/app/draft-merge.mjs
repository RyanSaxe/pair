import { uuid } from "#frame/app/util.mjs";
import { itemKey, splitKey } from "#shared/draft-items.mjs";

const record = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const emptySynced = (id = null) => ({ id, revision: 0, items: {} });

// digest sorts object keys first, so it returns the same string for two
// copies of an item whose fields are in a different order.
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

/* draftItems returns the items of the draft that the hub shares: each note,
   choice and answer that no submission from this browser sent, and the
   "everything else looks good" switch when it is off. It leaves out every
   checklist that the reviewer never touched, because the frame builds an
   untouched checklist from the page in each browser, and sending it would
   replace a checklist the reviewer changed on another device. */
export function draftItems(draft) {
  const items = {};
  for (const note of draft.notes)
    if (!note.sentIn) items[itemKey("note", note.id)] = note;
  for (const [key, choice] of Object.entries(draft.choices))
    if (!choice.sentIn && (choice.kind !== "multiple" || choice.touched))
      items[itemKey("choice", key)] = choice;
  for (const [key, answer] of Object.entries(draft.answers))
    if (!answer.sentIn) items[itemKey("answer", key)] = answer;
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

// recordPushed records the hub's value for each item that this browser just
// sent and the hub kept. Without the record, an item that the reviewer
// changed back to its last merged value before the hub answered would match
// the last merge, and mergeDraft() would replace it with the value sent.
export function recordPushed(draft, changes, hub) {
  if (hub.id !== draft.synced.id) return;
  for (const [key, value] of Object.entries(changes)) {
    const item = hub.items[key];
    const known = draft.synced.items[key];
    if (!item || (known && item.rev <= known.rev)) continue;
    if (digest(item.value) === digest(value))
      draft.synced.items[key] = { rev: item.rev, digest: digest(value) };
  }
}
// forgetSent deletes the synced record of each item that markSent() just
// marked as sent, so draftChanges() does not send a removal for it. The hub
// removes the sent items itself when it saves the submission.
export function forgetSent(draft, before) {
  const after = draftItems(draft);
  for (const key of Object.keys(before))
    if (!(key in after)) delete draft.synced.items[key];
}

const fields = { choice: "choices", answer: "answers" };
function sentHere(draft, kind, id) {
  if (kind === "note")
    return Boolean(draft.notes.find((note) => note.id === id)?.sentIn);
  if (kind in fields) return Boolean(draft[fields[kind]][id]?.sentIn);
  return false;
}
// apply returns the page of the item it changed, or null for the switch.
function apply(draft, kind, id, value) {
  if (kind === "alignUnflagged") {
    draft.alignUnflagged = value ?? true;
    return null;
  }
  if (kind === "note") {
    const index = draft.notes.findIndex((note) => note.id === id);
    const topic = draft.notes[index]?.topic ?? value?.topic;
    if (value === null) {
      if (index >= 0) draft.notes.splice(index, 1);
    } else if (index >= 0) draft.notes[index] = value;
    else draft.notes.push(value);
    return topic;
  }
  const map = draft[fields[kind]];
  const topic = map[id]?.topic ?? value?.topic;
  // A question's box shows the typed text before the answer, and the typed
  // text stays after Answer. When the typed text is the answer this value
  // replaces, it goes too, so the box shows the new answer. Text the reviewer
  // typed since stays.
  if (kind === "answer" && draft.drafts[id] === map[id]?.text)
    delete draft.drafts[id];
  if (value === null) delete map[id];
  else map[id] = value;
  return topic;
}

/* mergeDraft applies the hub's draft to this browser's draft. It returns
   null when nothing here changed, and otherwise the IDs of the pages whose
   items changed. For each item the hub changed since the last merge, the
   hub's value replaces this browser's value, unless the reviewer changed
   the item here since the last merge. That change has not reached the hub
   yet, so the hub will receive it later and keep it. The hub refuses every
   change to a deleted note, so mergeDraft gives a note changed here after
   its delete a new ID, which keeps the reviewer's words as a new note.
   mergeDraft never changes an item that this browser sent.

   The tabs of a session in one browser share one saved draft, with its
   synced record, but each tab reads the hub's draft on its own. A tab can
   therefore hold a copy of the hub's draft older than the one another tab
   already merged, so mergeDraft ignores a copy no newer than the last merge.
   Such a copy can contain an item that was deleted since. */
export function mergeDraft(draft, hub) {
  if (hub.id !== draft.synced.id) draft.synced = emptySynced(hub.id);
  else if (hub.revision <= draft.synced.revision) return null;
  const synced = draft.synced.items;
  const local = draftItems(draft);
  let pages = null;
  const changed = (topic) => (pages ||= new Set()).add(topic);
  for (const [key, item] of Object.entries(hub.items)) {
    const known = synced[key];
    const parts = splitKey(key);
    if (!parts || (known && item.rev <= known.rev)) continue;
    if (sentHere(draft, parts.kind, parts.id)) continue;
    const theirs = digest(item.value);
    const mine = digest(local[key]);
    const dirty = mine !== (known?.digest ?? none);
    if (mine === theirs) {
      // draftItems() counts an untouched checklist as no item, and a
      // tombstone for its key means that another browser sent that
      // checklist.
      if (
        item.value === null &&
        parts.kind === "choice" &&
        draft.choices[parts.id]
      )
        changed(apply(draft, parts.kind, parts.id, null));
    } else if (dirty && parts.kind === "note" && !item.value) {
      const note = draft.notes.find((entry) => entry.id === parts.id);
      note.id = uuid();
      changed(note.topic);
    } else if (dirty) continue;
    else
      changed(apply(draft, parts.kind, parts.id, structuredClone(item.value)));
    synced[key] = { rev: item.rev, digest: theirs };
  }
  draft.synced.revision = hub.revision;
  return pages;
}
