// A session is live, paused or closed. pair pause sets paused, and pair start
// clears it. The reviewer's Close sets closedAt, and pair start --reopen clears
// it. Close leaves paused as it was, so lifecycle checks closedAt first. Both
// fields are in the hub's state and in the status it sends, so the hub, the
// commands and the frame call lifecycle on whichever they have.
export const lifecycle = (state) =>
  state?.closedAt ? "closed" : state?.paused ? "paused" : "live";

export const isClosed = (state) => lifecycle(state) === "closed";

// The actions each lifecycle state accepts. A change is any request that
// changes the session: an agent command other than pair status, a send, a
// thread message, a draft change or a proposal action. A wake is the hub
// waking the holder for a send or a Start, or for quiet work. A reopen is
// pair start --reopen.
const accepted = {
  live: ["change", "wake"],
  paused: ["change"],
  closed: ["reopen"],
};

export const accepts = (state, action) =>
  accepted[lifecycle(state)].includes(action);

// roundStage works out where the current round stands from the round fields.
// unread is true while a submission that answers a round waits for pair read.
// Feedback the agent read answers the current round until the agent publishes
// the next round, so the round is working from pair read until its last page.
export function roundStage(state, unread = false) {
  if (unread) return "submitted";
  if (!state.current) return "ready";
  if (state.openRound || state.latestSubmissionRound === state.current.round)
    return "working";
  return "updated";
}

// Before closedAt, the hub stored the stage, and Close set it to "complete"
// with the time in dismissedAt. upgrade converts a status.json of that format,
// for the hub when it loads a session and for search when it reads one.
export function upgrade(state) {
  const { stage, dismissedAt, ...rest } = state;
  if (stage === "complete" && !rest.closedAt)
    rest.closedAt = dismissedAt || rest.updatedAt;
  return rest;
}
