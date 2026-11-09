import { requireValue, timestamp } from "../../shared/util.mjs";

// startPages marks each page in ids started in set, a copy of the open round,
// with the note when there is one. pair progress --page and pair publish
// --start both start pages with it.
export function startPages(set, ids, note) {
  const at = timestamp();
  for (const id of ids) {
    const slot = set.pages.find((item) => item.id === id);
    requireValue(
      slot && !slot.recordPath,
      `Page ${id} is not in this round's page list, or you already published it.`,
      409,
    );
    slot.state = "active";
    slot.startedAt ??= at;
    if (note) slot.note = { text: note, at };
  }
}

// A publish that leaves pages of the round unpublished leaves one of them
// started, because the quiet check counts only started pages.
export function requireStarted(set) {
  const left = set.pages.filter((slot) => !slot.recordPath);
  requireValue(
    !left.length || left.some((slot) => slot.state === "active"),
    `None of the pages left in round ${set.round} has started: ${left.map((slot) => slot.id).join(", ")}. Run the same pair publish again with --start ID for the page you work on next.`,
    409,
  );
}

export function pageNotes(session) {
  // notePage returns a state patch instead of writing it, so ack can apply
  // the note and its report in one transition. A note on a page that has not
  // started marks the page started, as pair progress --page does.
  function notePage(id, text) {
    const set = structuredClone(session.state.openRound);
    requireValue(
      set && session.stage() === "working",
      "Publish Agreed before a page note",
      409,
    );
    const slot = set.pages.find((item) => item.id === id);
    requireValue(slot, `Unknown page ${id} in round ${set.round}`, 409);
    requireValue(!slot.recordPath, `Page ${id} is already published`, 409);
    const at = timestamp();
    if (slot.state !== "active") {
      slot.state = "active";
      set.generation++;
    }
    slot.startedAt ??= at;
    slot.note = { text, at };
    return {
      openRound: set,
      roundPages: { ...session.state.roundPages, [set.round]: set },
      pageSetGeneration: set.generation,
    };
  }
  return { notePage };
}
