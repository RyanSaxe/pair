// A thread's state comes from three facts the hub stores on it. readCount is
// the number of messages the agent's last pair read --thread printed.
// A reply that leaves the reviewer's later messages waiting has answers, the
// number of messages, from the first, that it answers. wake.through is the
// number of messages when the hub's last wake for the thread went out, beside
// that wake's ok.
//
// The agent answers with a reply, or with pair reply --ack, which adds an
// agent message with kind "ack" and no words. An ack answers the same
// messages a reply in its place would. It is not the reviewer's thumbs up on
// a reply, which is acknowledgedAt on that reply and no part of the state.

// A reply or an ack without answers answers every message before it.
function answered(messages) {
  const reply = messages.findLastIndex((message) => message.from === "agent");
  return reply < 0 ? 0 : (messages[reply].answers ?? reply);
}

// The first of the reviewer's messages that no reply answers, or undefined.
export const waitingMessage = ({ messages }) =>
  messages.slice(answered(messages)).find((item) => item.from === "reviewer");

// A thread waits for the agent until a reply or an ack answers every message
// of the reviewer's, and is then replied or agentAcknowledged after the
// agent's newest message. Until then its state follows the reviewer's newest
// message: the wake for it goes out, then the agent reads it. lifecycleState
// is what lifecycle in lifecycle.mjs returns for the session. The hub refuses
// every reply in a closed session, so a thread that waits there is
// unanswered. The hub sends no wake in a paused session, so a thread whose
// wake has not gone out there is held.
export function threadState(thread, lifecycleState = "live") {
  if (!waitingMessage(thread)) {
    const answer = thread.messages.findLast(
      (message) => message.from === "agent",
    );
    return answer.kind === "ack" ? "agentAcknowledged" : "replied";
  }
  if (lifecycleState === "closed") return "unanswered";
  const { messages, readCount = 0, wake } = thread;
  const asked = messages.findLastIndex(
    (message) => message.from === "reviewer",
  );
  if (readCount > asked) return "read";
  if ((wake?.through ?? 0) <= asked) {
    return lifecycleState === "paused" ? "held" : "sending";
  }
  return wake.ok ? "sent" : "failed";
}

// The actions each state accepts. A wake is the hub waking the holder for a
// message the reviewer adds. A thread that is sending has a wake waiting to
// go out, and the new message joins it. A paused session takes no wake, so
// neither does a held thread. A read is pair read --thread recording readAt,
// which a read after the agent read or answered every message leaves as it
// was. Every read records readCount, which leaves such a thread in its state.
// An ack is pair reply --ack, which moves the thread to agentAcknowledged and
// needs a message that waits. A reply moves a thread in any state of a live or
// paused session to replied, and a message the reviewer adds moves a replied
// or agentAcknowledged thread back to sending.
const accepted = {
  sending: ["read", "ack"],
  held: ["read", "ack"],
  sent: ["wake", "read", "ack"],
  failed: ["wake", "read", "ack"],
  read: ["wake", "ack"],
  replied: ["wake"],
  agentAcknowledged: ["wake"],
  unanswered: [],
};

export const threadAccepts = (thread, action) =>
  accepted[threadState(thread)].includes(action);

// Before these facts, the hub stored the state. upgradeThread converts a
// thread saved that way when the hub loads it. The agent of a read thread had
// read every message. The wake of a sent or failed thread went out with every
// message, and the last wake of a sending thread went out before the
// reviewer's newest message.
export function upgradeThread(thread) {
  const { state, ...rest } = thread;
  if (state === undefined) return thread;
  const { messages } = rest;
  if (state === "read") rest.readCount ??= messages.length;
  if (state === "sent" || state === "failed") {
    rest.wake = {
      ...rest.wake,
      ok: state === "sent",
      through: messages.length,
    };
  }
  if (state === "sending" && rest.wake) {
    rest.wake = {
      ...rest.wake,
      through: messages.findLastIndex((item) => item.from === "reviewer"),
    };
  }
  return rest;
}
