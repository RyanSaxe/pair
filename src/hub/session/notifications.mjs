import { requireValue } from "../../shared/util.mjs";
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

// A reply's event has the fields that the frame opens a thread with, so an event
// that the hub copies for Mark unread opens the same way.
export const replyEvent = (thread, index) => ({
  kind: "reply",
  name: thread.page,
  ...(thread.proposal
    ? { page: "work", proposal: thread.proposal }
    : { round: thread.round, page: thread.topic }),
  ...(thread.target ? { target: thread.target } : {}),
  thread: thread.id,
  message: index,
});

export function notifications(session) {
  const { threadRecords: records } = session;
  // A line has the start of the thread's newest message. waitingSince is when the
  // reviewer wrote the first message the agent has not answered, readAt is when
  // the agent last ran pair read on the thread, and answeredAt is when the agent's
  // last reply came. message and at name the newest message.
  const threadLines = () =>
    [...records.values()].map((thread) => {
      const { messages } = thread;
      const reply = messages.findLast((item) => item.from === "agent");
      const unanswered = messages[messages.indexOf(reply) + 1];
      const newest = messages.at(-1);
      return {
        thread: thread.id,
        name: thread.page,
        text: newest ? clipped(newest) : (thread.anchor ?? ""),
        message: messages.length - 1,
        at: newest?.at ?? thread.createdAt,
        ...(thread.proposal
          ? { page: "work", proposal: thread.proposal }
          : { round: thread.round, page: thread.topic }),
        ...(thread.target ? { target: thread.target } : {}),
        ...(unanswered
          ? { waitingSince: unanswered.at, readAt: thread.readAt }
          : { answeredAt: reply?.at }),
      };
    });
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
  const notificationView = () => ({
    threads: threadLines(),
    proposals: session.proposalItems().map(cardFields),
  });
  // activity.json stores no words, so older events get them too. A cleared event
  // shows nowhere, so the session list carries words only for the others.
  const withWords = (events, cleared = new Set()) =>
    events.map((event) => {
      const message =
        event.kind === "reply" &&
        !cleared.has(event.id) &&
        records.get(event.thread)?.messages[event.message];
      return message ? { ...event, words: clipped(message) } : event;
    });
  function threadOriginal({ thread: id, message: index }) {
    const thread = records.get(id);
    requireValue(thread, `No thread ${id} in this session`, 404);
    const message = Number.isInteger(index) ? thread.messages[index] : null;
    requireValue(
      message?.from === "agent",
      "Only an agent's message can be marked unread",
    );
    return { ...replyEvent(thread, index), at: message.at };
  }
  /* The hub's list of cleared events only grows, and each browser merges its copy
     back in, so taking an ID off the list would bring it back from another device.
     A new event with a new ID is unread everywhere, and the old one stays cleared.
     again marks the copy, so it fires no system notification. */
  async function markUnread(data) {
    const original =
      data?.event !== undefined
        ? session.activityItems().find(({ id }) => id === data.event)
        : threadOriginal(data ?? {});
    requireValue(original, `No event ${data.event} in this session`, 404);
    const { id, at, ...rest } = original;
    const event = await session.addActivity({ ...rest, again: true }, at);
    return { event: withWords([event])[0] };
  }
  return { notificationView, withWords, markUnread };
}
