import { $ } from "#frame/app/util.mjs";
import { editable, waiting } from "#frame/app/view.mjs";
import {
  closeSentSend,
  submissionError,
  submissionInFlight,
} from "#frame/review/send.mjs";
import { refreshSend } from "#frame/review/send-popup.mjs";
import { connected, remote, selectedTab } from "#frame/sync/rounds.mjs";
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
  { editable, closed, sending, sent, openRound, connected, failed } = facts(),
) {
  if (!editable || closed) return "read-only";
  if (sending) return "sending";
  if (sent) return "waiting";
  if (openRound) return "pages-pending";
  if (!connected) return "unreachable";
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
  if (now === "waiting") closeSentSend();
  else refreshSend();
}
