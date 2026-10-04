import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startHub } from "../../../src/hub/server.mjs";
import { hub, planData } from "../../support/hub.mjs";

const listedEvents = async (origin, id) =>
  (await (await fetch(`${origin}/api/sessions`)).json()).sessions.find(
    (item) => item.id === id,
  ).events;
// What each event says, without the ID and time the hub gives it.
const described = (events) => events.map(({ id, at, ...rest }) => rest);

test("a session's start, a round that finishes and a reply each add one event, and a new hub keeps them", async (t) => {
  const h = await hub(t);
  const a = await h.session({ start: true });
  // pair start again on the session it started adds nothing.
  await h.register(a.directory, a.inbox.target, { start: true });
  assert.equal((await a.publish(planData("1", "plan"))).code, 200);
  const thread = crypto.randomUUID();
  const started = await a.request(`${a.base}/api/threads`, {
    id: thread,
    round: "1",
    topic: "overview",
    anchor: "Failure handling",
    target: "failure",
    text: "What happens to a failed item?",
  });
  assert.equal(started.code, 201, started.body.error);
  // Reading a thread is not an event, and the reply is.
  assert.equal((await a.action("reply", { note: thread })).code, 200);
  assert.equal(
    (await a.action("reply", { note: thread, text: "It is retried." })).code,
    200,
  );

  const events = await listedEvents(h.server.origin, a.id);
  assert.deepEqual(described(events), [
    { kind: "session", agent: "Claude Code" },
    { kind: "waiting", round: "1", offer: "plan" },
    {
      kind: "reply",
      name: "Overview",
      round: "1",
      page: "overview",
      target: "failure",
      thread,
      message: 1,
    },
  ]);
  assert.equal(new Set(events.map((event) => event.id)).size, 3);
  assert.ok(events.every((event) => Date.parse(event.at)));
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(a.directory, "activity.json"), "utf8"),
    ),
    { events },
  );
  await h.server.close();
  const next = await startHub(h.config);
  t.after(next.close);
  assert.deepEqual(await listedEvents(next.origin, a.id), events);
});

test("a session keeps its last 50 events", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const thread = crypto.randomUUID();
  await a.request(`${a.base}/api/threads`, {
    id: thread,
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "Why?",
  });
  for (let index = 1; index <= 50; index++)
    await a.action("reply", { note: thread, text: `Reply ${index}` });
  const events = await listedEvents(h.server.origin, a.id);
  assert.equal(events.length, 50);
  assert.deepEqual(
    events.map((event) => event.kind),
    Array(50).fill("reply"),
  );
});
