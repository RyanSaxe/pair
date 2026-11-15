import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readPlanData } from "../../../src/shared/records.mjs";
import { threadState } from "../../../src/shared/thread-state.mjs";
import { hub, planData, sleep, waitUntil } from "../../support/hub.mjs";

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

// published publishes round 1 in a new session and returns helpers for the
// reviewer's side of a thread.
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
  // The frame works a card's state out from the thread the hub sends.
  const thread = async (id) => {
    const found = (await a.status()).body.threads.find(
      (item) => item.id === id,
    );
    return { ...found, state: threadState(found) };
  };
  // The hub records the wake's result on the thread once it has run.
  const settled = (id) =>
    waitUntil(async () => (await thread(id)).state !== "sending");
  return { h, a, upload, start, send, thread, settled };
}

test("a thread wakes the holder with each message the reviewer sends, whether or not the agent read it", async (t) => {
  const { a, upload, start, send, thread, settled } = await published(t);
  const image = await upload();
  const started = await start({ attachments: [image] });
  assert.equal(started.code, 201, started.body.error);
  const { id } = started.body.thread;
  assert.equal(await settled(id), true);
  assert.equal((await thread(id)).state, "sent");
  const wakes = () => a.inbox.wakes.map((wake) => wake.message.message.content);
  const line = `pair: your user wrote to you in a thread on "Overview" in pair, for session ${a.directory}. Before your next step, run pair read --session-dir ${a.directory} --thread ${id}, which marks the thread read for your user and prints it with how to answer it. Then go on with your work.`;
  assert.deepEqual(wakes(), [
    `${line}\n\nYour user's message, which pair read also prints:\nWhat happens to a failed item?\n\nYour user attached an image to the message. pair read prints its path.`,
  ]);
  const stored = JSON.parse(
    await fs.readFile(path.join(a.directory, "threads", `${id}.json`), "utf8"),
  );
  assert.equal(stored.messages[0].attachments[0].path, image.path);
  assert.equal(stored.wake.via, "inbox");
  // A thread never changes the round. When the hub wakes the holder for it, the
  // hub sets holder.steerable, which the frame reads.
  const status = (await a.status()).body;
  assert.equal(status.stage, "updated");
  assert.equal(status.latestSubmissionId, undefined);
  assert.equal(status.holder.steerable, true);

  // An agent can act on the quoted message without reading the thread, so a
  // second message wakes it again with that message.
  const waiting = await send(id, { text: "Or a retry?" });
  assert.equal(waiting.code, 201, waiting.body.error);
  assert.equal(threadState(waiting.body.thread), "sending");
  assert.equal(await settled(id), true);
  assert.equal((await thread(id)).state, "sent");
  assert.equal(wakes().length, 2);
  const opened = await a.action("reply", { note: id });
  assert.deepEqual(
    opened.body.thread.messages.map((message) => message.text),
    ["What happens to a failed item?", "Or a retry?"],
  );
  assert.equal((await thread(id)).state, "read");

  // The hub cuts a message over 500 characters at a space, so the word
  // across the 500th character is left out.
  const words = "word ".repeat(99);
  assert.equal((await send(id, { text: `${words}boundary` })).code, 201);
  assert.equal(await settled(id), true);
  assert.equal((await thread(id)).state, "sent");
  assert.equal((await a.action("reply", { note: id })).code, 200);
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
    ["reviewer", "reviewer", "reviewer", "agent", "reviewer"],
  );
  assert.deepEqual(wakes().slice(1), [
    `${line}\n\nYour user's message, which pair read also prints:\nOr a retry?`,
    `${line}\n\nThe beginning of your user's message, which pair read prints whole:\n${words.trimEnd()}…`,
    `${line}\n\nYour user's message, which pair read also prints:\nAnd a retry?`,
  ]);
});

// The hub stores where a thread on one line of a diff or one box of a diagram
// is, and refuses a malformed place.
for (const { name, field, value, malformed } of [
  {
    name: "a diff thread keeps its selected side and line",
    field: "diffLine",
    value: { side: "deletions", lineNumber: 4 },
    malformed: { side: "context", lineNumber: 0 },
  },
  {
    name: "a thread on a diagram's box keeps the box's ID",
    field: "diagramNode",
    value: "W",
    malformed: "  ",
  },
])
  test(`${name} in status and storage`, async (t) => {
    const { a, start, thread, settled } = await published(t);
    const started = await start({ quote: "selected code", [field]: value });
    assert.equal(started.code, 201, started.body.error);
    const { id } = started.body.thread;
    assert.deepEqual(started.body.thread[field], value);
    await settled(id);
    assert.deepEqual((await thread(id))[field], value);

    const saved = JSON.parse(
      await fs.readFile(
        path.join(a.directory, "threads", `${id}.json`),
        "utf8",
      ),
    );
    assert.deepEqual(saved[field], value);

    const refused = await start({ quote: "selected code", [field]: malformed });
    assert.equal(refused.code, 400);
  });

test("a repeated reply ID returns the saved thread without another message or wake", async (t) => {
  const { a, start, send, thread, settled } = await published(t);
  const { id } = (await start()).body.thread;
  assert.equal(await settled(id), true);

  const first = await send(id, { replyId: "reply-1", text: "Keep this." });
  assert.equal(first.code, 201, first.body.error);
  assert.equal(await settled(id), true);

  const duplicate = await send(id, {
    replyId: "reply-1",
    text: "Discard this retry body.",
  });
  assert.equal(duplicate.code, 201, duplicate.body.error);
  assert.equal(duplicate.body.thread.messages.length, 2);
  assert.equal(threadState(duplicate.body.thread), "sent");
  assert.equal(duplicate.body.thread.messages[1].replyId, "reply-1");
  assert.equal(duplicate.body.thread.messages[1].text, "Keep this.");
  await sleep(100);
  assert.equal((await thread(id)).messages.length, 2);
  assert.equal((await thread(id)).messages[1].text, "Keep this.");
  assert.equal(a.inbox.wakes.length, 2);
});

test("a thread reply refuses a malformed reply ID without adding a message or wake", async (t) => {
  const { a, start, send, thread, settled } = await published(t);
  const { id } = (await start()).body.thread;
  assert.equal(await settled(id), true);

  const invalid = await send(id, { replyId: "bad id", text: "Discard this." });
  assert.equal(invalid.code, 400);
  assert.equal((await thread(id)).messages.length, 1);
  assert.equal(a.inbox.wakes.length, 1);
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
  await a.action("reply", { note: id });
  assert.equal((await thread(id)).state, "replied");
});

// The card reads the thread's state and Notifications reads its line, so both
// must keep waiting on a message the agent's reply did not answer.
test("a reply leaves the reviewer's follow-up waiting when the agent last read the thread before it", async (t) => {
  const { a, start, send, thread, settled } = await published(t);
  const { id } = (await start()).body.thread;
  await settled(id);
  const line = async () =>
    (await a.request("/api/notifications")).body.sessions[a.id].threads.find(
      (item) => item.thread === id,
    );
  const read = `pair read --session-dir ${a.directory} --thread ${id}`;
  const answer = async (text) => {
    const replied = await a.action("reply", { note: id, text });
    assert.equal(replied.code, 200, replied.body.error);
    return replied.body.next;
  };
  assert.equal((await a.action("reply", { note: id })).code, 200);
  const followUp = await send(id, { text: "Or a retry?" });
  assert.equal(followUp.code, 201, followUp.body.error);
  await settled(id);

  const next = await answer("It stops.");
  assert.equal((await thread(id)).state, "sent");
  assert.ok(next.includes(`Run ${read},`), next);
  const waiting = await line();
  assert.equal(waiting.waitingSince, followUp.body.thread.messages[1].at);
  assert.equal(waiting.state, "sent");

  assert.equal((await a.action("reply", { note: id })).code, 200);
  assert.equal((await thread(id)).state, "read");
  assert.ok((await thread(id)).readAt);
  assert.equal((await line()).state, "read");
  assert.ok(!(await answer("No retry.")).includes(read));
  assert.equal((await thread(id)).state, "replied");
  assert.equal((await line()).state, "replied");

  // An agent can answer the message its wake quotes without running pair
  // read --thread, and that reply answers the thread.
  assert.equal((await send(id, { text: "And refunds?" })).code, 201);
  await settled(id);
  await answer("Refunds stop too.");
  assert.equal((await thread(id)).state, "replied");
  assert.equal((await line()).state, "replied");
});

// Without the line, the Next line after the agent read a thread told it to
// end its turn, and nothing named the thread it had not answered.
test("every Next line names each thread the agent has not answered, until it answers", async (t) => {
  const { a, start, send, settled } = await published(t);
  const first = (await start()).body.thread.id;
  const second = (await start({ text: "Why three retries?" })).body.thread.id;
  await settled(first);
  await settled(second);
  const next = async () => (await a.action("status")).body.next;
  const read = (id) => `pair read --session-dir ${a.directory} --thread ${id}`;
  const both = `You have not answered the reviewer's threads ${first} on "Overview" and ${second} on "Overview". Before you end your turn, run ${read("ID")} for each of them`;
  assert.ok((await next()).includes(both), await next());
  assert.equal((await a.action("reply", { note: first })).code, 200);
  assert.ok((await next()).includes(both), await next());

  const answered = await a.action("reply", { note: first, text: "It stops." });
  assert.equal(answered.code, 200, answered.body.error);
  assert.ok(
    answered.body.next.includes(
      `You have not answered the reviewer's thread ${second} on "Overview". Before you end your turn, run ${read(second)},`,
    ),
    answered.body.next,
  );
  assert.equal(
    (await a.action("reply", { note: second, text: "Three." })).code,
    200,
  );
  assert.ok(!(await next()).includes("You have not answered"), await next());

  // A paused session's agent has ended its turn.
  assert.equal((await send(first, { text: "And a fourth?" })).code, 201);
  assert.equal(
    (await a.action("pause", { reason: "Done for today" })).code,
    200,
  );
  assert.ok(!(await next()).includes("You have not answered"), await next());
});

test("the status names a reply's images by address and writes their box, and the thread keeps them", async (t) => {
  const { h, a, start, thread, settled } = await published(t);
  const { id } = (await start({ quote: "A failed item" })).body.thread;
  await settled(id);
  // A PNG's signature and header give its size: 600 by 300.
  const shot = Buffer.alloc(24);
  shot.set([137, 80, 78, 71, 13, 10, 26, 10]);
  shot.writeUInt32BE(600, 16);
  shot.writeUInt32BE(300, 20);
  const image = `data:image/png;base64,${shot.toString("base64")}`;
  const svg = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
  const html = [
    `<img alt="Whole" src="${image}">`,
    `<img src="${image}" width="200" />`,
    `<img src="${image}" width="50%">`,
    `<img src="${svg}" alt="Drawn">`,
    '<img src="https://example.test/shot.png">',
  ].join("");
  const posted = await a.action("reply", { note: id, html });
  assert.equal(posted.code, 200, posted.body.error);

  const address = (index) => `${a.base}/api/thread-image/${id}/1/${index}`;
  assert.equal(
    (await thread(id)).messages[1].html,
    [
      `<img alt="Whole" src="${address(0)}" width="600" height="300">`,
      `<img src="${address(1)}" width="200" height="100"/>`,
      // A percentage gives the browser no box, so this image stays in its tag.
      `<img src="${image}" width="50%">`,
      `<img src="${svg}" alt="Drawn">`,
      '<img src="https://example.test/shot.png">',
    ].join(""),
  );

  const served = await fetch(h.server.origin + address(0));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.match(served.headers.get("cache-control"), /immutable/);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), shot);
  assert.equal((await fetch(h.server.origin + address(2))).status, 404);
  // The reviewer's message has text and no images.
  assert.equal(
    (await fetch(`${h.server.origin}${a.base}/api/thread-image/${id}/0/0`))
      .status,
    404,
  );

  // The agent reads what it wrote, and the stored thread keeps it.
  const read = await a.action("reply", { note: id });
  assert.equal(read.body.thread.messages.at(-1).html, html);
  const saved = JSON.parse(
    await fs.readFile(path.join(a.directory, "threads", `${id}.json`), "utf8"),
  );
  assert.equal(saved.messages[1].html, html);
});

// The hub records the reviewer's thumbs up on the agent's reply without a wake
// or a bell event, and the agent reads it on the thread.
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

// Besides the round's pages, the reviewer can start a thread on Agreed's
// progress card, on Review's overall comment and on Work, and the hub's wake
// message contains the thread's place. Agreed is never in the round's page
// list.
test("a thread starts on Agreed's progress card, on the overall comment and on Work, and reading it names its place", async (t) => {
  const { a, start, settled } = await published(t);
  for (const [topic, anchor, target, page] of [
    ["agreed", "Progress", "agent-activity", "Agreed so far"],
    ["overall", "Overall", undefined, "Overall"],
    ["work", "Work", undefined, "Work"],
  ]) {
    const started = await start({ topic, anchor, target });
    assert.equal(started.code, 201, started.body.error);
    const { id } = started.body.thread;
    await settled(id);
    assert.match(
      a.inbox.wakes.at(-1).message.message.content,
      new RegExp(
        `^pair: your user wrote to you in a thread on "${page}" in pair, for session `,
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
  // Closing the inbox stands in for an agent session that has ended.
  await a.inbox.close();
  const { id } = (await start()).body.thread;
  assert.equal(await settled(id), true);
  assert.equal((await thread(id)).state, "failed");
  // The wake's reason can contain the holder's socket path.
  assert.equal((await thread(id)).wake.reason, undefined);
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
  const snapshot = await a.servedRound("2");
  const [record] = readPlanData(snapshot).agreements[0].sourceRecords;
  assert.equal(record.kind, "thread");
  assert.equal(record.text, "What happens to a failed item?");
  assert.equal(record.quote, "A failed item");
  assert.equal(record.occurrence, 2);
  assert.equal(record.href, "./example.1.html?target=failure#overview");
});

test("a source on a proposal's card names the card, in a new round and in a round stored with no round or card in its source", async (t) => {
  const { a, settled } = await published(t);
  const proposed = await a.action("propose", {
    id: "rex",
    title: "Restart the Rex server",
    delivers: "The server answers again.",
    recommend: "here",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const id = crypto.randomUUID();
  const started = await a.request(`${a.base}/api/threads`, {
    id,
    proposal: "rex",
    text: "Can this wait until morning?",
  });
  assert.equal(started.code, 201, started.body.error);
  await settled(id);
  assert.equal((await a.feedback(a.event())).code, 200);
  await a.action("read");
  const cited = await a.publish({
    ...planData("2"),
    agreements: [
      {
        id: "rex",
        title: "Rex restarts in the morning",
        html: "<p>It can wait.</p>",
        sourceRefs: [{ kind: "thread", threadId: id }],
      },
    ],
  });
  assert.equal(cited.code, 200, cited.body.error);
  const onCard = {
    kind: "thread",
    threadId: id,
    text: "Can this wait until morning?",
    label: "Restart the Rex server",
    proposal: "rex",
  };
  // A browser gets a round's sources in the page, and in Agreed's record when
  // it changes round with no page load.
  const served = async () => {
    const manifest = (await a.request(`${a.base}/api/page-set?round=2`)).body;
    const { version } = manifest.pages.find((slot) => slot.id === "agreed");
    const record = await a.request(
      `${a.base}/api/page?round=2&id=agreed&version=${version}`,
    );
    return [
      readPlanData(await a.servedRound("2")).agreements[0].sourceRecords[0],
      record.body.page.agreements[0].sourceRecords[0],
    ];
  };
  assert.deepEqual(await served(), [onCard, onCard]);
  const pages = path.join(a.directory, "pages", "2");
  const file = path.join(
    pages,
    (await fs.readdir(pages)).find((name) => name.startsWith("agreed")),
  );
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  stored.page.agreements[0].sourceRecords = [
    {
      kind: "thread",
      threadId: id,
      text: "Can this wait until morning?",
      href: "./undefined.undefined.html#undefined",
    },
  ];
  await fs.writeFile(file, JSON.stringify(stored));
  assert.deepEqual(await served(), [onCard, onCard]);
});
