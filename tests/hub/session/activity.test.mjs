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

test("a published page, a reply and side work's pull request each add one event, which a new hub keeps", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
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
  await a.action("side-work", {
    change: "add",
    title: "Delete visual-review",
    text: "The skill is deprecated but still installed.",
    source: "From the conversation",
  });
  assert.equal(
    (await a.request(`${a.base}/api/side-work/1/start`, {})).code,
    200,
  );
  const update = (fields) =>
    a.action("side-work", { change: "update", id: "1", ...fields });
  assert.equal((await update({ state: "working" })).code, 200);
  const url = "https://github.com/RyanSaxe/pair/pull/12";
  assert.equal((await update({ state: "pr", url: url + "0" })).code, 200);
  const announced = (await listedEvents(h.server.origin, a.id)).at(-1);
  // Correcting the link changes the event it added, and finishing the work
  // adds nothing.
  assert.equal((await update({ state: "pr", url })).code, 200);
  assert.equal((await update({ state: "done" })).code, 200);

  const events = await listedEvents(h.server.origin, a.id);
  assert.equal(events.at(-1).id, announced.id);
  assert.deepEqual(described(events), [
    { kind: "page", name: "Agreed so far", round: "1", page: "agreed" },
    { kind: "page", name: "Overview", round: "1", page: "overview" },
    {
      kind: "reply",
      name: "Overview",
      round: "1",
      page: "overview",
      target: "failure",
      thread,
    },
    {
      kind: "side-work",
      name: "Delete visual-review",
      url,
      page: "agreed",
      target: "side-work-1",
    },
  ]);
  assert.equal(new Set(events.map((event) => event.id)).size, 4);
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
  // The two page events were the oldest, so they went first.
  assert.deepEqual(
    events.map((event) => event.kind),
    Array(50).fill("reply"),
  );
});
