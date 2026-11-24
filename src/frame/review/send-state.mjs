import { callHook } from "#frame/app/hooks.mjs";
import {
  connected,
  remote,
  selectedTab,
  submissionError,
  submissionInFlight,
} from "#frame/app/state.mjs";
import { $ } from "#frame/app/util.mjs";
import { editable, online, plan, waiting } from "#frame/app/view.mjs";
import { isClosed } from "#shared/lifecycle.mjs";

// The fields that say where the send of Current's round stands. connected is
// null until the first status poll answers or fails, so Current stays
// unreachable until then.
const facts = () => ({
  editable,
  closed: isClosed(remote),
  sending: submissionInFlight,
  sent: waiting(),
  openRound: Boolean(remote?.openRound),
  connected: connected === true,
  failed: Boolean(submissionError),
});

// sendState works out where the reviewer's send of Current's round stands.
// sent is true when this browser or another sent the round, and openRound
// while the agent is still publishing its pages.
export function sendState(
  {
    editable: isEditable,
    closed,
    sending,
    sent,
    openRound,
    connected: isConnected,
    failed,
  } = facts(),
) {
  if (!isEditable || closed) return "read-only";
  if (sending) return "sending";
  if (sent) return "waiting";
  if (openRound) return "pages-pending";
  if (!isConnected) return "unreachable";
  return failed ? "failed" : "editing";
}

// The actions each state accepts. edit changes the draft's notes, choices and
// answers, and send opens the Send drawer and sends from it. A failed send
// can be sent again.
const accepted = {
  "read-only": [],
  sending: [],
  waiting: [],
  "pages-pending": ["edit"],
  unreachable: ["edit"],
  failed: ["edit", "send"],
  editing: ["edit", "send"],
};

export const sendAccepts = (action, state = sendState()) =>
  accepted[state].includes(action);

// The draft, the drawer and sendFeedback() belong to the round on screen, so
// they take an action only while the Current tab is selected.
export const onCurrent = (action) =>
  selectedTab === "current" && sendAccepts(action);

export const feedbackEditable = () => onCurrent("edit");

// A note on a round whose feedback was sent can still start a thread,
// because the agent answers threads while it prepares the next round or
// builds. The hub accepts threads only on its current round, until the
// session is complete.
export const noteEditable = () =>
  feedbackEditable() ||
  (editable &&
    online &&
    !isClosed(remote) &&
    remote?.current?.name === plan.name &&
    remote?.current?.round === plan.round);

// review() runs after every poll and every action, and calls settleSend. When
// the state changes while the Send drawer is open, the drawer closes if
// another tab or device sent the round, and otherwise its Send follows the
// header's.
let last = null;
export function settleSend() {
  const now = sendState();
  if (now === last) return;
  last = now;
  if (!$("send-dialog").open) return;
  if (now === "waiting") callHook("closeSentSend");
  else callHook("refreshSend");
}
