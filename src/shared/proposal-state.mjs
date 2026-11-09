// No field on a proposal card names its state. started, declined, withdrawn
// and done are each null until their event happens, and proposalState names
// the card's state from them:
//
//   proposed   nobody has started, declined, withdrawn or finished the card
//   running    the reviewer started it in this session
//   opening    the reviewer started it in a sub-session or with a new agent,
//              and no session has run pair start --from for it yet
//   linked     the session that pair start --from created builds it
//   done       the agent ran --done, or --done --where for work finished
//              somewhere else
//   joined     the agent joined it into another card with --join
//   closed     the reviewer closed its linked session
//   declined   the reviewer declined it
//   withdrawn  the agent withdrew it
//
// The hub, the commands and the frame all call proposalState. A built page
// contains only the shared modules that frame modules import, so this module
// imports nothing.
export function proposalState(card) {
  if (card.declined) return "declined";
  if (card.withdrawn) return "withdrawn";
  if (card.done?.joined) return "joined";
  if (card.done) return card.done.by === "close" ? "closed" : "done";
  if (!card.started) return "proposed";
  if (card.started.where === "here") return "running";
  return card.started.session ? "linked" : "opening";
}

// The states each action accepts. done is --done and doneWhere is --done
// --where. join is the card that --join merges, and joinInto is the card it
// merges into. openAgent is Open a new agent session, and link is pair start
// --from. close and reopenSession are the reviewer closing and reopening the
// linked session.
const accepted = {
  revise: ["proposed"],
  withdraw: ["proposed"],
  decline: ["proposed"],
  start: ["proposed"],
  openAgent: ["proposed", "opening"],
  join: ["proposed"],
  joinInto: ["proposed", "running"],
  restore: ["declined", "withdrawn"],
  done: ["running"],
  doneWhere: ["proposed", "running"],
  reopen: ["done", "joined"],
  status: ["running", "opening", "linked"],
  link: ["opening"],
  close: ["linked"],
  reopenSession: ["closed"],
};

export const allows = (card, action) =>
  accepted[action].includes(proposalState(card));
