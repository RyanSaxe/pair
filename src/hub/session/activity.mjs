import crypto from "node:crypto";
import path from "node:path";
import { atomic, exists, read, timestamp } from "../../shared/util.mjs";

const kept = 50;

// The hub adds an event when a session starts, when a round waits for the
// reviewer, when an agent records a proposal, when the agent replies in a thread
// and when the reviewer marks something unread. Each event contains what it is
// about and where the frame opens it, such as a round, a page and a block on that
// page. The bell, the system notifications and the Notifications window read this
// list, so a reopen takes the session's rounds, proposals and starts out of all
// three. Its threads stay in the window as read, because the window lists them
// from the thread files.
export async function activity(session) {
  const file = path.join(session.directory, "activity.json");
  let events = (await exists(file)) ? (await read(file)).events : [];
  // A copy made for Mark unread keeps its original's time, so its row keeps its
  // place in the list.
  async function addActivity(event, at = timestamp()) {
    const added = { id: crypto.randomUUID(), ...event, at };
    events = [...events, added].slice(-kept);
    await atomic(file, { events });
    return added;
  }
  async function clearActivity() {
    events = [];
    await atomic(file, { events });
  }
  return { addActivity, clearActivity, activityItems: () => events };
}
