// A send is the reviewer's feedback or a Start. The hub saves each send, then
// wakes the holder and records the wake's result in wake.last as
// { at, ok, reason?, via? }. sentAt is when the hub saved the newest send, and
// holder.commandAt is when the holder last ran a pair command. Every command
// from the holder prints its next step, which tells it to run pair read while
// a send waits, so a command after a send, or after the send's failed wake,
// answers that wake. The hub's state and the status it sends both have these
// fields, so the hub, pair status and the frame call wakeState on either.
//
// A thread's wake is on the thread, and threadState in thread-state.mjs works
// it out.

const after = (a, b) => Date.parse(a) > Date.parse(b);

export function wakeState(status) {
  const sentAt = status?.sentAt;
  const last = status?.wake?.last;
  const answered = (at) => after(status?.holder?.commandAt, at);
  // No wake has gone out since the hub saved the newest send.
  if (!last || after(sentAt, last.at)) {
    if (!sentAt) return null;
    return answered(sentAt) ? "answered" : "owed";
  }
  if (last.ok) return "sent";
  return answered(last.at) ? "answered" : "failed";
}

// The actions each state accepts. A send is the hub sending the wake, which
// it does again when it loads a session whose wake a stopped hub still owed.
// An alert is the session list, the bell and the progress card telling the
// reviewer that the hub could not wake the agent.
const accepted = {
  owed: ["send"],
  sent: [],
  failed: ["alert"],
  answered: [],
};

export const wakeAccepts = (status, action) =>
  Boolean(accepted[wakeState(status)]?.includes(action));

// Whether the agent has received or read the reviewer's latest submission.
// pair progress records lastReceivedId and pair read records
// lastAcknowledgedId, each for the first send that pair read has not printed.
// deliveryState compares those IDs, not times, because the agent's last report
// can come from an earlier round.
export function deliveryState(status) {
  const latest = status?.latestSubmissionId;
  if (!latest) return null;
  if (status.lastAcknowledgedId === latest) return "read";
  return status.lastReceivedId === latest ? "received" : null;
}
