import crypto from "node:crypto";
import path from "node:path";
import { atomic, exists, read, timestamp } from "../../shared/util.mjs";

// How many events a session keeps. The bell lists them, and each browser
// keeps which of them it has cleared.
const kept = 50;

// The events the bell lists: a session that starts, a round that waits for
// the reviewer, and a reply in a thread. Each names what it is about and
// where it opens: a round, a page and a block on it.
export async function activity(session) {
  const file = path.join(session.directory, "activity.json");
  let events = (await exists(file)) ? (await read(file)).events : [];
  async function addActivity(event) {
    events = [
      ...events,
      { id: crypto.randomUUID(), ...event, at: timestamp() },
    ].slice(-kept);
    await atomic(file, { events });
  }
  return { addActivity, activityItems: () => events };
}
