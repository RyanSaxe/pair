/* The hub and the frame split the reviewer's unsent draft into items, so
   that a change on one device replaces one item on the other devices, not
   the whole draft. A key is "message", "alignUnflagged", or a kind and an ID
   joined by "/", such as "choice/overview/approach". An ID can contain "/". */
export const itemKinds = [
  "note",
  "choice",
  "answer",
  "draft",
  "noteDraft",
  "replyDraft",
];
const singles = ["message", "alignUnflagged"];

export const itemKey = (kind, id) => `${kind}/${id}`;

export function splitKey(key) {
  if (singles.includes(key)) return { kind: key, id: null };
  const slash = key.indexOf("/");
  const kind = key.slice(0, slash);
  return slash > 0 && slash < key.length - 1 && itemKinds.includes(kind)
    ? { kind, id: key.slice(slash + 1) }
    : null;
}

// sentItems returns the key of each item in a submission, with the value
// that the browser sent.
export function sentItems({ groups, message }) {
  const sent = [];
  for (const note of groups.notes || [])
    sent.push([itemKey("note", note.id), note]);
  for (const [key, choice] of Object.entries(groups.choices || {}))
    sent.push([itemKey("choice", key), choice]);
  for (const [key, answer] of Object.entries(groups.answers || {}))
    sent.push([itemKey("answer", key), answer]);
  if (message) sent.push(["message", message]);
  return sent;
}
