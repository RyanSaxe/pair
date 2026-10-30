/* The hub keeps the items of the reviewer's draft that the reviewer has
   completed: each note added to feedback, each choice, each answer and the
   "everything else looks good" switch. A change on one device replaces one
   item on the other devices, not the whole draft. A key is
   "alignUnflagged", or a kind and an ID joined by "/", such as
   "choice/overview/approach". An ID can contain "/". */
export const itemKinds = ["note", "choice", "answer"];

export const itemKey = (kind, id) => `${kind}/${id}`;

export function splitKey(key) {
  if (key === "alignUnflagged") return { kind: key, id: null };
  const slash = key.indexOf("/");
  const kind = key.slice(0, slash);
  return slash > 0 && slash < key.length - 1 && itemKinds.includes(kind)
    ? { kind, id: key.slice(slash + 1) }
    : null;
}

// sentItems returns the key of each item in a submission, with the value
// that the browser sent. The switch is an item only while it is off, as in the
// frame's draftItems().
export function sentItems({ groups }) {
  const sent = [];
  for (const note of groups.notes || [])
    sent.push([itemKey("note", note.id), note]);
  for (const [key, choice] of Object.entries(groups.choices || {}))
    sent.push([itemKey("choice", key), choice]);
  for (const [key, answer] of Object.entries(groups.answers || {}))
    sent.push([itemKey("answer", key), answer]);
  if (groups.alignUnflagged === false) sent.push(["alignUnflagged", false]);
  return sent;
}
