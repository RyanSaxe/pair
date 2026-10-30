import { requireValue, timestamp } from "../../shared/util.mjs";

export function pageNotes(session) {
  // notePage returns a state patch instead of writing it, so ack can apply
  // the note and its report in one transition. A note on a page that has not
  // started marks the page started, as pair progress --page does.
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
