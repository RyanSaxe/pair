import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readPlanData } from "../../../src/shared/records.mjs";
import { hub, planData, sleep, waitUntil } from "../../support/hub.mjs";

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

// A session with round 1 published, and the reviewer's side of a thread.
async function published(t) {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const upload = async () =>
    (
      await fetch(`${h.server.origin}${a.base}/api/upload`, {
        method: "POST",
        headers: { Origin: h.server.origin },
        body: png,
      })
    ).json();
  const start = (extra = {}) =>
    a.request(`${a.base}/api/threads`, {
      id: crypto.randomUUID(),
      round: "1",
      topic: "overview",
      anchor: "Failure handling",
      target: "failure",
      text: "What happens to a failed item?",
      ...extra,
    });
  const send = (id, data) =>
    a.request(`${a.base}/api/threads/${id}/messages`, data);
  const thread = async (id) =>
    (await a.status()).body.threads.find((item) => item.id === id);
  // The hub records the wake's result on the thread once it has run.
  const settled = (id) =>
    waitUntil(async () => (await thread(id)).state !== "sending");
  return { h, a, upload, start, send, thread, settled };
}

test("a thread wakes the holder once for each message the reviewer sends, with the message", async (t) => {
  const { a, upload, start, send, thread, settled } = await published(t);
  const image = await upload();
  const started = await start({ attachments: [image] });
  assert.equal(started.code, 201, started.body.error);
  const { id } = started.body.thread;
  assert.equal(await settled(id), true);
  assert.equal((await thread(id)).state, "sent");
  const wakes = () => a.inbox.wakes.map((wake) => wake.message.message.content);
  const line = `pair: the reviewer wrote to you in a thread on "Overview" in session ${a.directory}. Between your current steps, run pair read --session-dir ${a.directory} --thread ${id}, which prints the thread and how to answer it, then go on with your work.`;
  assert.deepEqual(wakes(), [
    `${line}\n\nThe reviewer's message, which pair read also prints:\nWhat happens to a failed item?\n\nThe reviewer attached an image to the message. pair read prints its path.`,
  ]);
  const stored = JSON.parse(
    await fs.readFile(path.join(a.directory, "threads", `${id}.json`), "utf8"),
  );
  assert.equal(stored.messages[0].attachments[0].path, image.path);
  assert.equal(stored.wake.via, "inbox");
  // A thread never changes the round, and its wake sets the holder's
  // steerable, which the frame reads.
  const status = (await a.status()).body;
  assert.equal(status.stage, "updated");
  assert.equal(status.latestSubmissionId, undefined);
  assert.equal(status.holder.steerable, true);

  assert.equal(
    (await a.action("reply", { note: id, text: "Kept." })).code,
    200,
  );
  assert.equal((await thread(id)).state, "replied");
  const answered = await send(id, { text: "And a retry?" });
  assert.equal(answered.code, 201, answered.body.error);
  assert.equal(await settled(id), true);
  assert.deepEqual(
    (await thread(id)).messages.map((message) => message.from),
    ["reviewer", "agent", "reviewer"],
  );
  // The hub cuts a message over 500 characters at a space, so the word
  // across the 500th character is left out.
  const words = "word ".repeat(99);
  assert.equal((await send(id, { text: `${words}boundary` })).code, 201);
  assert.equal(await settled(id), true);
  assert.deepEqual(wakes().slice(1), [
    `${line}\n\nThe reviewer's message, which pair read also prints:\nAnd a retry?`,
    `${line}\n\nThe beginning of the reviewer's message, which pair read prints whole:\n${words.trimEnd()}…`,
  ]);
});

// pair read --thread sends the reply action without text, and pair reply
// sends it with text or HTML.
test("the reply action marks the thread read, then posts text or a checked fragment", async (t) => {
  const { a, start, thread, settled } = await published(t);
  const { id } = (await start({ quote: "A failed item" })).body.thread;
  await settled(id);
  const opened = await a.action("reply", { note: id });
  assert.equal(opened.code, 200, opened.body.error);
  const read = await thread(id);
  assert.equal(read.state, "read");
  assert.ok(read.readAt);
  assert.equal(opened.body.thread.page, "Overview");
  assert.equal(opened.body.thread.anchor, "Failure handling");
  assert.equal(opened.body.thread.quote, "A failed item");

  const refusals = [
    [
      '<div data-choice="policy" data-label="Policy"><button data-value="a">A</button><button data-value="b">B</button></div>',
      /A reply cannot contain a decision, a checklist or a question/,
    ],
    [
      "<pre>no language</pre>",
      /^page "reply": a code block has no data-language$/,
    ],
    [
      '<div data-prototype="missing"></div>',
      /prototype "missing" does not exist/,
    ],
  ];
  for (const [html, error] of refusals) {
    const refused = await a.action("reply", { note: id, html });
    assert.equal(refused.code, 400);
    assert.match(refused.body.error, error);
  }
  assert.equal((await thread(id)).messages.length, 1);
  const posted = await a.action("reply", {
    note: id,
    html: '<pre data-language="js">retry(item);</pre>',
  });
  assert.equal(posted.code, 200, posted.body.error);
  const replied = await thread(id);
  assert.equal(replied.state, "replied");
  assert.equal(
    replied.messages[1].html,
    '<pre data-language="js">retry(item);</pre>',
  );
  // Reading a thread the agent has answered leaves it answered.
  await a.action("reply", { note: id });
  assert.equal((await thread(id)).state, "replied");
});

// The reviewer's thumbs up on the agent's reply: no wake, no bell line, and
// the agent reads it on the thread.
test("a thumbs up on a reply is recorded without a wake, drops its bell line and comes off again", async (t) => {
  const { h, a, start, thread, settled } = await published(t);
  const { id } = (await start()).body.thread;
  await settled(id);
  await a.action("reply", { note: id, text: "It is retried once." });
  const acknowledge = (data) =>
    a.request(`${a.base}/api/threads/${id}/acknowledge`, data);
  const replyLine = async () =>
    (await (await fetch(`${h.server.origin}/api/sessions`)).json()).sessions
      .find((item) => item.id === a.id)
      .events.find((event) => event.kind === "reply");

  const given = await acknowledge({ message: 1, acknowledged: true });
  assert.equal(given.code, 200, given.body.error);
  assert.ok(Date.parse((await thread(id)).messages[1].acknowledgedAt));
  assert.equal((await replyLine()).acknowledged, true);
  const read = await a.action("reply", { note: id });
  assert.match(read.body.next, /^The reviewer agreed with your last message/);
  // Only the reviewer's message woke the holder.
  await sleep(100);
  assert.equal(a.inbox.wakes.length, 1);

  for (const refused of [
    { message: 0, acknowledged: true },
    { message: 1, acknowledged: "yes" },
  ])
    assert.equal((await acknowledge(refused)).code, 400);
  const taken = await acknowledge({ message: 1, acknowledged: false });
  assert.equal(taken.code, 200, taken.body.error);
  assert.equal((await thread(id)).messages[1].acknowledgedAt, undefined);
  assert.equal((await replyLine()).acknowledged, undefined);
});

// The progress card's Message the agent button starts its thread on Agreed,
// which the round's page list never names.
// Besides the round's pages, a thread starts on Agreed's progress card, on
// Review's overall comment and on Work, and its wake names where.
test("a thread starts on Agreed's progress card, on the overall comment and on Work, and reading it names its place", async (t) => {
  const { a, start, settled } = await published(t);
  for (const [topic, anchor, target, page] of [
    ["agreed", "Progress", "agent-activity", "Agreed so far"],
    ["overall", "Overall feedback", undefined, "Overall feedback"],
    ["work", "Work", undefined, "Work"],
  ]) {
    const started = await start({ topic, anchor, target });
    assert.equal(started.code, 201, started.body.error);
    const { id } = started.body.thread;
    await settled(id);
    assert.match(
      a.inbox.wakes.at(-1).message.message.content,
      new RegExp(
        `^pair: the reviewer wrote to you in a thread on "${page}" in session `,
      ),
    );
    const opened = await a.action("reply", { note: id });
    assert.equal(opened.code, 200, opened.body.error);
    assert.equal(opened.body.thread.page, page);
    assert.equal(opened.body.thread.anchor, anchor);
  }
});

test("a thread the hub cannot wake the holder for shows as failed", async (t) => {
  const { a, start, thread, settled } = await published(t);
  // The inbox is gone, as it is once the agent's session has ended.
  await a.inbox.close();
  const { id } = (await start()).body.thread;
  assert.equal(await settled(id), true);
  assert.equal((await thread(id)).state, "failed");
  assert.equal((await thread(id)).wake, undefined);
});

test("a thread refuses an image the session does not have, and a closed session", async (t) => {
  const { a, start } = await published(t);
  const foreign = await start({ attachments: [{ id: "0123456789abcdef" }] });
  assert.equal(foreign.code, 400);
  assert.equal(
    foreign.body.error,
    "Image 0123456789abcdef is not in this session",
  );
  const offPage = await start({ topic: "missing" });
  assert.equal(offPage.code, 400);
  assert.equal((await a.request(`${a.base}/api/dismiss`, {})).code, 200);
  const closed = await start();
  assert.equal(closed.code, 409);
  assert.equal(closed.body.error, "This session is closed");
  assert.equal(a.inbox.wakes.length, 0);
});

test("Agreed cites a thread, and the publisher refuses one that does not exist", async (t) => {
  const { a, start, settled } = await published(t);
  const { id } = (await start({ quote: "A failed item", occurrence: 2 })).body
    .thread;
  await settled(id);
  assert.equal((await a.feedback(a.event())).code, 200);
  await a.action("read");
  const entry = (threadId) => ({
    id: "errors",
    title: "Per-item errors",
    html: "<p>Keep successful results.</p>",
    sourceRefs: [{ kind: "thread", threadId }],
  });
  const missing = await a.publish({
    ...planData("2"),
    agreements: [entry("no-such-thread")],
  });
  assert.equal(missing.code, 400);
  assert.equal(
    missing.body.error,
    "Agreed cites thread no-such-thread, which this session does not have. Cite a thread ID that pair read printed.",
  );
  const cited = await a.publish({ ...planData("2"), agreements: [entry(id)] });
  assert.equal(cited.code, 200, cited.body.error);
  const snapshot = await fs.readFile(
    path.join(a.directory, "rounds/example.2.html"),
    "utf8",
  );
  const [record] = readPlanData(snapshot).agreements[0].sourceRecords;
  assert.equal(record.kind, "thread");
  assert.equal(record.text, "What happens to a failed item?");
  assert.equal(record.quote, "A failed item");
  assert.equal(record.occurrence, 2);
  assert.equal(record.href, "./example.1.html?target=failure#overview");
});
