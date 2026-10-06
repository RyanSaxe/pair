import { requireValue } from "../../shared/util.mjs";

// The status of approved work: the parts the agent has finished and the
// parts still left, each in the order the agent gives them. pair propose
// with --status-done and --status-left replaces the whole status, and the
// card shows it until the work is finished. --reopen clears it.

// A status has at most 12 parts, each at most 80 characters, the limit for
// a card's title.
const most = { parts: 12, characters: 80 };

export function statusParts(data) {
  const parts = (name, flag) =>
    [data[name] ?? []].flat().map((part) => {
      const text = typeof part === "string" ? part.trim() : "";
      requireValue(
        text && text.length <= most.characters,
        `Each --${flag} is text of at most ${most.characters} characters.`,
      );
      return text;
    });
  const done = parts("statusDone", "status-done");
  const left = parts("statusLeft", "status-left");
  const count = done.length + left.length;
  requireValue(count, "Give at least one --status-done or --status-left.");
  requireValue(
    count <= most.parts,
    `A status has at most ${most.parts} parts, and you gave ${count}.`,
  );
  return { done, left };
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
