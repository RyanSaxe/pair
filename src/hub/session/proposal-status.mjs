import { requireValue } from "../../shared/util.mjs";

// The status of approved work: one list of its parts, in the order the
// agent added them, each left, done or dropped. pair propose adds a part
// with --status-left or --status-done and marks one with --status-done or
// --status-drop, and no flag removes a part, so the card keeps every part
// until the work is finished. --reopen clears it.

// A status has at most 20 parts, each at most 80 characters, the limit for
// a card's title.
const most = { parts: 20, characters: 80 };
// Each flag, with the state it gives the parts it names, in the order the
// hub applies them. The done parts come before the left parts that one
// call adds, as in a status from before parts had states.
const flags = [
  ["statusDone", "status-done", "done"],
  ["statusLeft", "status-left", "left"],
  ["statusDrop", "status-drop", "dropped"],
];

// The parts each flag names, checked before the hub reads the card.
export function statusChange(data) {
  const change = flags.map(([name, flag, state]) => ({
    state,
    texts: [data[name] ?? []].flat().map((part) => {
      const text = typeof part === "string" ? part.trim() : "";
      requireValue(
        text && text.length <= most.characters,
        `Each --${flag} is text of at most ${most.characters} characters.`,
      );
      return text;
    }),
  }));
  requireValue(
    change.some(({ texts }) => texts.length),
    "Give at least one --status-done, --status-left or --status-drop.",
  );
  return change;
}

// The card's parts after a change. A left part the card lists keeps its
// state, a done part is marked done or added as done, and a dropped part
// must be one the card lists.
export function changedParts(card, change) {
  const before = card.status?.parts ?? [];
  const parts = before.map((part) => ({ ...part }));
  for (const { state, texts } of change)
    for (const text of texts) {
      const part = parts.find((item) => item.text === text);
      if (part && state !== "left") part.state = state;
      else if (!part) {
        requireValue(state !== "dropped", unknown(card.id, text, before));
        parts.push({ text, state });
      }
    }
  requireValue(
    parts.length <= most.parts,
    `A status has at most ${most.parts} parts, and proposal ${card.id} would have ${parts.length}.`,
  );
  return parts;
}

function unknown(id, text, parts) {
  const listed = parts.map((part) => `"${part.text}"`).join(", ");
  return parts.length
    ? `Proposal ${id} has no part "${text}" to drop. Its parts are ${listed}.`
    : `Proposal ${id} has no parts yet, so it has no part "${text}" to drop.`;
}

// A card saved before parts had states lists its done parts and its left
// parts apart, and reads as one list with the done parts first.
export function loadedStatus(status) {
  if (status.parts) return status;
  const { at, done = [], left = [] } = status;
  return {
    at,
    parts: [
      ...done.map((text) => ({ text, state: "done" })),
      ...left.map((text) => ({ text, state: "left" })),
    ],
  };
}

// Only approved work that is not finished takes a status.
export function statusable(card) {
  const { id } = card;
  requireValue(
    !card.declined,
    `The reviewer declined proposal ${id}, so you cannot record a status for it.`,
    409,
  );
  requireValue(
    !card.withdrawn,
    `Proposal ${id} is withdrawn, so you cannot record a status for it.`,
    409,
  );
  requireValue(
    !card.done,
    `Proposal ${id} is marked done, so you cannot record a status for it.`,
    409,
  );
  requireValue(
    card.started,
    `The reviewer has not approved proposal ${id}, so you cannot record a status for it yet.`,
    409,
  );
  return card;
}
