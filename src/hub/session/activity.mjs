import crypto from "node:crypto";
import path from "node:path";
import { atomic, exists, read, timestamp } from "../../shared/util.mjs";

// How many events a session keeps. The notification center shows them, and
// each browser keeps which of them it has seen or cleared.
const kept = 50;

// The events the notification center announces: a page published, a reply
// in a thread, and side work that opened a pull request. Each names what it
// is about and where it opens: a round, a page and a block on it.
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
  // A correction, such as side work's new link, changes an event in place,
  // so it keeps its ID and each browser keeps what it saw of it.
  async function reviseActivity(match, patch) {
    events = events.map((event) =>
      match(event) ? { ...event, ...patch } : event,
    );
    await atomic(file, { events });
  }
  return { addActivity, reviseActivity, activityItems: () => events };
}
