import { requireValue, timestamp } from "../../shared/util.mjs";

// A note on one page of the open round, which the progress card shows on
// that page's row until the page publishes or gets a newer note.
export function pageNotes(session) {
  // Returns the state patch, so ack can apply it with its report in one
  // transition. A note on a page not yet started marks it started, as
  // pair progress --start would.
  function notePage(id, text) {
    const set = structuredClone(session.state.openRound);
    requireValue(
      set && session.state.stage === "working",
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
