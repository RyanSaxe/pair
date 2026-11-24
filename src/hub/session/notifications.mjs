import { threadState, waitingMessage } from "../../shared/thread-state.mjs";
import { parse, textOf } from "../search/html.mjs";

/* The frame's Notifications window lists every thread of every open session,
   which is too much for the session list that each tab reads every 5 seconds.
   The frame asks for notificationView only while that window is open. */
const lineLength = 160;
const clipped = (message) =>
  (message.text !== undefined
    ? message.text
    : textOf(parse(message.html ?? ""))
  ).slice(0, lineLength);

// A card's fields hold more than the frame shows on a row, such as a reason, so
// this sends only what the frame's cardState reads.
const cardFields = ({ id, declined, withdrawn, done, started }) => ({
  id,
  declined: Boolean(declined),
  withdrawn: Boolean(withdrawn),
  done: Boolean(done),
  started: started && {
    where: started.where,
    session: started.session ? { id: started.session.id } : null,
    planFirst: started.planFirst,
    built: started.built,
  },
});

export function notifications(session) {
  const { threadRecords: records } = session;
  // A line has the start of the thread's newest message with words, which an
  // agent's ack has not, and the thread's state. waitingSince is when the
  // reviewer wrote the first message the agent has not answered. message and
  // at name the newest message.
  const threadLines = () =>
    [...records.values()].map((thread) => {
      const { messages } = thread;
      const waiting = waitingMessage(thread);
      const newest = messages.at(-1);
      const worded = messages.findLast((message) => message.kind !== "ack");
      const line = {
        thread: thread.id,
        name: thread.page,
        text: worded ? clipped(worded) : (thread.anchor ?? ""),
        message: messages.length - 1,
        at: newest?.at ?? thread.createdAt,
        state: threadState(thread),
      };
      if (thread.proposal) {
        line.page = "work";
        line.proposal = thread.proposal;
      } else {
        line.round = thread.round;
        line.page = thread.topic;
      }
      if (thread.target) line.target = thread.target;
      if (waiting) line.waitingSince = waiting.at;
      return line;
    });
  const notificationView = () => ({
    threads: threadLines(),
    proposals: session.proposalItems().map(cardFields),
  });
  // activity.json stores no words, so older events get them too. A cleared event
  // shows nowhere, so the session list carries words only for the others. A
  // reply's question is the reviewer's message that began its thread. An ack
  // has no words, and the frame names it.
  const withWords = (events, cleared) =>
    events.map((event) => {
      const messages =
        event.kind === "reply" &&
        !cleared.has(event.id) &&
        records.get(event.thread)?.messages;
      const message = messages?.[event.message];
      if (!message) return event;
      const question = messages.find((item) => item.from === "reviewer");
      return Object.assign(
        {},
        event,
        message.kind === "ack" ? null : { words: clipped(message) },
        question ? { question: clipped(question) } : null,
      );
    });
  return { notificationView, withWords };
}
