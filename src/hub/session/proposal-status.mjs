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
        `--${flag} takes text of at most ${most.characters} characters`,
      );
      return text;
    });
  const done = parts("statusDone", "status-done");
  const left = parts("statusLeft", "status-left");
  const count = done.length + left.length;
  requireValue(count, "A status takes --status-done or --status-left");
  requireValue(
    count <= most.parts,
    `A status takes at most ${most.parts} parts, and this one has ${count}.`,
  );
  return { done, left };
}

// Only approved work that is not finished takes a status.
export function statusable(card) {
  const { id } = card;
  requireValue(
    !card.declined,
    `The reviewer declined proposal ${id}, so it takes no status.`,
    409,
  );
  requireValue(
    !card.withdrawn,
    `Proposal ${id} was withdrawn, so it takes no status.`,
    409,
  );
  requireValue(
    !card.done,
    `Proposal ${id} is done, so it takes no status.`,
    409,
  );
  requireValue(
    card.started,
    `Proposal ${id} has not been started, so it takes no status.`,
    409,
  );
  return card;
}
