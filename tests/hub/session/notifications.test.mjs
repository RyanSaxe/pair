import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { hub, planData } from "../../support/hub.mjs";

async function published(t) {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const start = async (text = "What happens to a failed item?") => {
    const id = crypto.randomUUID();
    const started = await a.request(`${a.base}/api/threads`, {
      id,
      round: "1",
      topic: "overview",
      anchor: "Failure handling",
      target: "failure",
      text,
    });
    assert.equal(started.code, 201, started.body.error);
    return id;
  };
  const reply = async (note, words = { text: "Here." }) => {
    const replied = await a.action("reply", { note, ...words });
    assert.equal(replied.code, 200, replied.body.error);
  };
  const lines = async () =>
    (await a.request("/api/notifications")).body.sessions[a.id];
  const line = async (id) =>
    (await lines()).threads.find(({ thread }) => thread === id);
  const events = async () =>
    (await a.request("/api/sessions")).body.sessions.find(
      (entry) => entry.id === a.id,
    ).events;
  return { h, a, start, reply, lines, line, events };
}

test("the notifications route lists every thread with its newest message, and the session list has none", async (t) => {
  const { a, start, reply, lines, line } = await published(t);
  const answered = await start("Why three retries? ".repeat(20));
  const waiting = await start();
  const first = await line(answered);
  assert.equal(first.text.length, 160);
  assert.equal(first.message, 0);
  assert.ok(first.waitingSince);
  assert.notEqual(first.state, "read");

  // pair read --thread shows on the line that the agent opened the thread.
  await reply(answered, {});
  assert.equal((await line(answered)).state, "read");

  await reply(answered);
  const replied = await line(answered);
  assert.equal(replied.text, "Here.");
  assert.equal(replied.message, 1);
  assert.equal(replied.waitingSince, undefined);
  assert.equal(replied.state, "replied");

  // The line waits from the first message the agent has not answered, and shows
  // the newest.
  const say = (text) =>
    a.request(`${a.base}/api/threads/${answered}/messages`, {
      replyId: crypto.randomUUID(),
      text,
    });
  assert.equal((await say("And on refunds?")).code, 201);
  const later = await line(answered);
  assert.equal((await say("And on returns?")).code, 201);
  const both = await line(answered);
  assert.equal(both.text, "And on returns?");
  assert.equal(both.waitingSince, later.waitingSince);
  assert.notEqual(both.state, "read");

  // A later round keeps the answered thread, which a thread's card can still show.
  await reply(answered);
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal((await a.action("read")).code, 200);
  assert.equal((await a.publish(planData("2"))).code, 200);
  assert.deepEqual(
    (await lines()).threads.map(({ thread }) => thread).sort(),
    [answered, waiting].sort(),
  );

  const { sessions } = (await a.request("/api/sessions")).body;
  assert.equal(sessions.find(({ id }) => id === a.id).threads, undefined);
});

test("an agent's HTML reply reads as plain text on its line and in its event's words", async (t) => {
  const { start, reply, line, events } = await published(t);
  const id = await start();
  await reply(id, {
    html: "<p>Use <b>three</b> retries,</p><ul><li>then stop.</li></ul>",
  });
  assert.equal((await line(id)).text, "Use three retries, then stop.");
  assert.equal(
    (await events()).find(({ kind }) => kind === "reply").words,
    "Use three retries, then stop.",
  );
});

test("only a reply that isn't cleared carries its words and its thread's question, and activity.json stores neither", async (t) => {
  const { a, start, reply, events } = await published(t);
  const id = await start();
  await reply(id, { text: "First." });
  await reply(id, { text: "Second." });
  const [first, second] = (await events()).filter(
    ({ kind }) => kind === "reply",
  );
  assert.equal(first.words, "First.");
  assert.equal(second.words, "Second.");
  assert.equal(second.question, "What happens to a failed item?");

  assert.equal(
    (await a.request("/api/seen", { cleared: [first.id] })).code,
    200,
  );
  const after = (await events()).filter(({ kind }) => kind === "reply");
  assert.equal(after[0].words, undefined);
  assert.equal(after[0].question, undefined);
  assert.equal(after[1].words, "Second.");

  const stored = JSON.parse(
    await fs.readFile(path.join(a.directory, "activity.json"), "utf8"),
  );
  assert.equal(
    stored.events.some((event) => "words" in event || "question" in event),
    false,
  );
});

test("a proposal's event counts as acknowledged once the card is started, declined, withdrawn or done", async (t) => {
  const { a, events } = await published(t);
  const propose = async (id) => {
    const added = await a.action("propose", {
      id,
      title: `Work ${id}`,
      delivers: "It works.",
      recommend: "here",
    });
    assert.equal(added.code, 200, added.body.error);
  };
  const acknowledged = async (id) =>
    (await events()).find(({ proposal }) => proposal === id).acknowledged;
  for (const id of ["waits", "started", "declined", "withdrawn", "done"])
    await propose(id);
  const act = (id, verb, data) =>
    a.request(`${a.base}/api/proposals/${id}/${verb}`, data ?? {});
  assert.equal((await act("started", "start", { where: "here" })).code, 200);
  assert.equal((await act("declined", "decline")).code, 200);
  const withdrawn = await a.action("propose", {
    id: "withdrawn",
    withdraw: true,
    reason: "Not needed.",
  });
  assert.equal(withdrawn.code, 200, withdrawn.body.error);
  const done = await a.action("propose", {
    id: "done",
    done: true,
    where: "#1",
  });
  assert.equal(done.code, 200, done.body.error);

  assert.equal(await acknowledged("waits"), undefined);
  for (const id of ["started", "declined", "withdrawn", "done"])
    assert.equal(await acknowledged(id), true, id);
});

test("the notifications route gives each card the fields its state word reads, and no more", async (t) => {
  const { a, lines } = await published(t);
  const added = await a.action("propose", {
    id: "deck",
    title: "Build the deck",
    delivers: "The deck.",
    recommend: "here",
  });
  assert.equal(added.code, 200, added.body.error);
  assert.deepEqual((await lines()).proposals, [
    {
      id: "deck",
      declined: false,
      withdrawn: false,
      done: false,
      started: null,
    },
  ]);
  const started = await a.request(`${a.base}/api/proposals/deck/start`, {
    where: "here",
  });
  assert.equal(started.code, 200, started.body.error);
  const [card] = (await lines()).proposals;
  assert.equal(card.started.where, "here");
});
