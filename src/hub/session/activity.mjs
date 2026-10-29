import crypto from "node:crypto";
import path from "node:path";
import { atomic, exists, read, timestamp } from "../../shared/util.mjs";

const kept = 50;

// The frame's bell lists these events. The hub adds one when a session
// starts, when a round waits for the reviewer, when an agent records a
// proposal and when the agent replies in a thread. Each event contains what
// it is about and where the frame opens it, such as a round, a page and a
// block on that page.
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
