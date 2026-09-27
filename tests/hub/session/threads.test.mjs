import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readPlanData } from "../../../src/shared/records.mjs";
import { hub, planData, waitUntil } from "../../support/hub.mjs";

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

test("a thread wakes the holder once for each message the reviewer sends", async (t) => {
  const { a, upload, start, send, thread, settled } = await published(t);
  const image = await upload();
  const started = await start({ attachments: [image] });
  assert.equal(started.code, 201, started.body.error);
  const { id } = started.body.thread;
  assert.equal(await settled(id), true);
  assert.equal((await thread(id)).state, "sent");
  assert.deepEqual(
    a.inbox.wakes.map((wake) => wake.message.message.content),
    [
      `pair: a thread on "Overview", session ${a.directory}, needs an answer. Answer it between your current steps without dropping your work: run pair reply --session-dir ${a.directory} --note ${id}, which prints the thread and how to answer.`,
    ],
  );
  const stored = JSON.parse(
    await fs.readFile(path.join(a.directory, "threads", `${id}.json`), "utf8"),
  );
  assert.equal(stored.messages[0].attachments[0].path, image.path);
  // A thread never changes the round.
  const status = (await a.status()).body;
  assert.equal(status.stage, "updated");
  assert.equal(status.latestSubmissionId, undefined);

  assert.equal(
    (await a.action("reply", { note: id, text: "Kept." })).code,
    200,
  );
  assert.equal((await thread(id)).state, "replied");
  const answered = await send(id, { text: "And a retry?" });
  assert.equal(answered.code, 201, answered.body.error);
  assert.equal(await settled(id), true);
  assert.equal(a.inbox.wakes.length, 2);
  assert.deepEqual(
    (await thread(id)).messages.map((message) => message.from),
    ["reviewer", "agent", "reviewer"],
  );
});

test("pair reply marks the thread read, then posts text or a checked fragment", async (t) => {
  const { a, start, thread, settled } = await published(t);
  const { id } = (await start({ quote: "A failed item" })).body.thread;
  await settled(id);
  const opened = await a.action("reply", { note: id });
  assert.equal(opened.code, 200, opened.body.error);
  const read = await thread(id);
  assert.equal(read.state, "read");
  assert.ok(read.readAt);
  assert.match(
    opened.body.text,
    new RegExp(
      `^Thread ${id} on "Overview", block "Failure handling" \\(session ${a.directory}, round 1\\)\n  On the text: "A failed item"\n  You, \\d\\d:\\d\\d: What happens to a failed item\\?\n`,
    ),
  );
  assert.match(opened.body.text, /--note \S+ --file reply.html\n/);

  const refusals = [
    [
      '<div data-choice="policy" data-label="Policy"><button data-value="a">A</button><button data-value="b">B</button></div>',
      /A reply cannot contain a decision, checklist or question/,
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
  assert.match(posted.body.text, /^Posted your reply in thread /);
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
  const { id } = (await start({ quote: "A failed item" })).body.thread;
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
  assert.equal(missing.body.error, "Source thread not found");
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
  assert.equal(record.href, "./example.1.html?target=failure#overview");
});
