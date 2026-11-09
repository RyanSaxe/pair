import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import { pageData } from "../../../src/shared/records.mjs";
import { frameSource } from "../../support/frame.mjs";
import { planData, task, hub as testHub } from "../../support/hub.mjs";

// session starts a hub and a session for each test, so no test depends on
// rounds that another test published. publish sends one page of a round, with
// the page list and the pages to start in options. firstAgreed starts detail.
async function session(t) {
  const h = await testHub(t);
  const a = await h.session();
  const status = async () => (await a.status()).body;
  const page = async (round, id, title, html, extra = {}) =>
    buildPage(path.join(a.directory, "source.json"), {
      name: "page-test",
      round,
      title: "Page test",
      page: {
        id,
        title,
        ...(id === "agreed" ? { agreements: [], task } : { html }),
        ...extra,
      },
    });
  const publish = async (round, id, title, html, extra, options = {}) =>
    a.action("publish", {
      html: await page(round, id, title, html, extra),
      ...options,
    });
  const firstAgreed = () =>
    publish(
      "1",
      "agreed",
      "Agreed so far",
      undefined,
      { agreements: firstAgreements },
      { pages: firstPages, start: ["detail"] },
    );
  return { a, status, page, publish, firstAgreed };
}
const firstPages = [
  { id: "overview", title: "Overview" },
  { id: "detail", title: "Detail" },
];
const firstAgreements = [
  { id: "alpha", title: "Alpha", html: "<p>Same</p>", source: "Conversation" },
  { id: "beta", title: "Beta", html: "<p>Before</p>", source: "Conversation" },
];

test("Agreed and all page names become visible in one publication", async (t) => {
  const { a, status, publish } = await session(t);
  assert.equal((await publish("1", "agreed", "Agreed so far")).code, 400);
  assert.equal((await status()).current, null);
  assert.equal(
    (
      await publish(
        "1",
        "agreed",
        "Agreed so far",
        undefined,
        {},
        {
          pages: [firstPages[0], firstPages[0]],
          start: ["overview"],
        },
      )
    ).code,
    400,
  );
  assert.equal((await status()).current, null);
  // An Agreed that would leave no page started publishes nothing.
  const unstarted = await publish(
    "1",
    "agreed",
    "Agreed so far",
    undefined,
    { agreements: firstAgreements },
    { pages: firstPages },
  );
  assert.equal(unstarted.code, 409);
  assert.equal(
    unstarted.body.error,
    "None of the pages left in round 1 has started: overview, detail. Run the same pair publish again with --start ID for the page you work on next.",
  );
  assert.equal((await status()).current, null);
  assert.deepEqual(await fs.readdir(path.join(a.directory, "pages", "1")), []);
  const result = await publish(
    "1",
    "agreed",
    "Agreed so far",
    undefined,
    { agreements: firstAgreements },
    { pages: firstPages, start: ["detail"], note: " Measuring " },
  );
  assert.equal(result.code, 200, result.body.error);
  assert.equal(result.body.page.id, "agreed");
  assert(
    result.body.next.endsWith(
      'Then: You still have to publish these pages: overview, detail (started). When you begin any work a page will report, such as the code it describes or what it measures, and at least every five minutes while you or a subagent do that work, run pair progress --page ID --note "…". Publish each page with pair publish as soon as pair build has built it, with --start ID for the page you work on next while other pages are left.',
    ),
    result.body.next,
  );
  const [, detail] = (await status()).openRound.pages;
  assert.equal(detail.state, "active");
  assert.equal(detail.note.text, "Measuring");
  assert.equal((await status()).rounds.length, 0);
  const { body: html } = await a.request(`${a.base}/`);
  assert.match(frameSource(html), /Agreed so far/);
  assert.match(html, /"pageMode":"partial"/);
  assert.match(html, /Detail/);
  const { body: manifest } = await a.request(`${a.base}/api/page-set?round=1`);
  assert.deepEqual(
    manifest.pages.map((item) => item.id),
    ["agreed", "overview", "detail"],
  );
  assert.equal(manifest.pages[1].state, "queued");
  assert.equal(manifest.pages[2].state, "active");
  assert.equal(manifest.complete, false);
  assert.equal(
    (
      await publish(
        "1",
        "detail",
        "Detail",
        "<p>x</p>",
        {},
        {
          pages: firstPages,
        },
      )
    ).code,
    400,
  );
  assert.equal((await a.action("progress", { start: ["missing"] })).code, 409);
  assert.equal(
    (await publish("1", "unlisted", "Unlisted", "<p>x</p>")).code,
    409,
  );
});

test("listed pages arrive independently and only the last completes the round", async (t) => {
  const { a, status, page, publish, firstAgreed } = await session(t);
  const readyPages = async () =>
    (await a.request("/api/sessions")).body.sessions.find(
      (item) => item.id === a.id,
    ).readyPages;
  await firstAgreed();
  assert.deepEqual(await readyPages(), { round: "1", ids: ["agreed"] });
  const before = await status();
  assert.equal(before.openRound.pages[1].state, "active");
  assert.equal(before.needsYou, false);
  const early = await a.feedback(
    a.event("feedback-only", "1", { name: "page-test" }),
  );
  assert.equal(early.code, 409);
  // A page that would leave no page started publishes nothing and starts
  // nothing, and the same publish with --start does both.
  const unstarted = await publish(
    "1",
    "detail",
    "Detail",
    "<p>Finished detail</p>",
  );
  assert.equal(unstarted.code, 409);
  assert.match(unstarted.body.error, /has started: overview\. Run the same/);
  assert.deepEqual((await status()).openRound, before.openRound);
  assert.deepEqual(await readyPages(), { round: "1", ids: ["agreed"] });
  const detail = await publish(
    "1",
    "detail",
    "Detail",
    "<p>Finished detail</p>",
    {},
    { start: ["overview"] },
  );
  assert.equal(detail.code, 200, detail.body.error);
  assert.equal(detail.body.status.openRound.pages[0].state, "active");
  assert.equal(detail.body.roundComplete, false);
  assert.deepEqual(await readyPages(), {
    round: "1",
    ids: ["agreed", "detail"],
  });
  const immutable = await fs.readFile(detail.body.page.recordPath, "utf8");
  const pageSet = async (round) =>
    a.request(`${a.base}/api/page-set?round=${round}`);
  const record = (id, version) =>
    a.request(`${a.base}/api/page?round=1&id=${id}&version=${version}`);
  const slot = (await pageSet("1")).body.pages.find(
    (item) => item.id === "detail",
  );
  assert.equal(slot.state, "ready");
  const recorded = await record("detail", slot.version);
  assert.equal(recorded.code, 200);
  assert.match(recorded.body.page.html, /Finished detail/);
  assert.equal((await record("detail", "0".repeat(64))).code, 404);
  const valid = await page(
    "1",
    "overview",
    "Overview",
    "<p>Finished overview</p>",
  );
  const tampered = pageData(valid);
  tampered.page.html = "<h1>Duplicate heading</h1>";
  const failed = await a.action("publish", {
    html: valid.replace(
      /(<script type="application\/json" id="page-data">)[\s\S]*?(<\/script>)/,
      (_, start, end) =>
        start + JSON.stringify(tampered).replaceAll("<", "\\u003c") + end,
    ),
  });
  assert.equal(failed.code, 400);
  assert.deepEqual((await status()).current, detail.body.status.current);
  // A directory in the way of status.json fails the write that commits the
  // page. The session keeps its state and drops the page's record, so the page
  // can publish again.
  const stateFile = path.join(a.directory, "status.json");
  const held = path.join(a.directory, "status-held.json");
  const records = path.join(a.directory, "pages", "1");
  const recordsBefore = await fs.readdir(records);
  await fs.rename(stateFile, held);
  await fs.mkdir(stateFile);
  try {
    const writeFailure = await publish(
      "1",
      "overview",
      "Overview",
      "<p>Finished overview</p>",
    );
    assert.equal(writeFailure.code, 500);
    assert.deepEqual((await status()).current, detail.body.status.current);
    assert.deepEqual(await fs.readdir(records), recordsBefore);
  } finally {
    await fs.rmdir(stateFile);
    await fs.rename(held, stateFile);
  }
  const overview = await publish(
    "1",
    "overview",
    "Overview",
    "<p>Finished overview</p>",
  );
  assert.equal(overview.code, 200, overview.body.error);
  assert.equal(overview.body.roundComplete, true);
  assert.deepEqual(await readyPages(), {
    round: "1",
    ids: ["agreed", "overview", "detail"],
  });
  assert.equal((await status()).rounds.length, 1);
  assert.equal((await status()).openRound, null);
  assert.equal((await status()).needsYou, true);
  const { body: completeSet } = await pageSet("1");
  assert.equal(completeSet.complete, true);
  for (const round of ["missing", "constructor"])
    assert.equal((await pageSet(round)).code, 404);
  assert.equal(
    (await record("missing", completeSet.pages[0].version)).code,
    404,
  );
  assert.equal(
    await fs.readFile(detail.body.page.recordPath, "utf8"),
    immutable,
  );
  assert.equal(
    (await publish("1", "detail", "Detail", "<p>again</p>")).code,
    409,
  );
});

test("the next round may choose unrelated pages without changing history", async (t) => {
  const { a, status, publish, firstAgreed } = await session(t);
  await firstAgreed();
  await publish(
    "1",
    "detail",
    "Detail",
    "<p>Finished detail</p>",
    {},
    {
      start: ["overview"],
    },
  );
  await publish("1", "overview", "Overview", "<p>Finished overview</p>");
  const feedback = a.event("feedback-only", "1", {
    name: "page-test",
    groups: {
      notes: [
        {
          id: "note-1",
          topic: "detail",
          anchor: "Detail",
          text: "This is agreed.",
        },
      ],
    },
  });
  const response = await a.feedback(feedback);
  assert.equal(response.code, 200, response.body.error);
  assert.equal((await a.action("read")).code, 200);
  const agreed = await publish(
    "2",
    "agreed",
    "Agreed so far",
    undefined,
    {
      agreements: [
        { ...firstAgreements[1], html: "<p>After</p>" },
        {
          id: "gamma",
          title: "Gamma",
          html: "<p>New</p>",
          source: "Conversation",
        },
        firstAgreements[0],
        {
          id: "from-detail",
          title: "A settled detail",
          html: "<p>The earlier detail is settled.</p>",
          sourceRefs: [
            { kind: "note", submissionId: feedback.id, noteId: "note-1" },
          ],
        },
      ],
    },
    {
      pages: [
        { id: "overview", title: "Overview" },
        { id: "new-topic", title: "New topic" },
      ],
      start: ["overview", "new-topic"],
    },
  );
  assert.equal(agreed.code, 200, agreed.body.error);
  const source = JSON.parse(
    await fs.readFile(agreed.body.page.recordPath, "utf8"),
  ).page.agreements.find((entry) => entry.id === "from-detail")
    .sourceRecords[0];
  assert.equal(source.round, "1");
  assert.equal(source.topic, "detail");
  const ordered = JSON.parse(
    await fs.readFile(agreed.body.page.recordPath, "utf8"),
  ).page.agreements.map((entry) => entry.id);
  assert.deepEqual(ordered, ["beta", "gamma", "from-detail", "alpha"]);
  const [one, two] = await Promise.all([
    publish("2", "new-topic", "New topic", "<p>Fresh topic</p>"),
    publish("2", "overview", "Overview", "<p>New overview</p>"),
  ]);
  assert.equal(one.code, 200, one.body.error);
  assert.equal(two.code, 200, two.body.error);
  const { body: old } = await a.request(`${a.base}/r/1`);
  const { body: fresh } = await a.request(`${a.base}/`);
  assert.match(old, /Finished detail/);
  assert.doesNotMatch(fresh, /Finished detail/);
  assert.match(fresh, /Fresh topic/);
  assert.equal((await status()).rounds.length, 2);
  assert.equal((await a.request(`${a.base}/api/page-set?round=1`)).code, 200);
});

test("a page note sits on its slot until the page publishes", async (t) => {
  const { a, publish, status } = await session(t);
  const pages = [...firstPages, { id: "steps", title: "Steps" }];
  const agreed = await publish(
    "1",
    "agreed",
    "Agreed so far",
    undefined,
    {},
    { pages, start: ["steps"] },
  );
  assert.equal(agreed.code, 200, agreed.body.error);
  assert.equal((await a.action("ack", { note: "Reading" })).code, 200);
  const before = (await status()).report;
  const noted = await a.action("ack", { note: " Drafting ", page: "detail" });
  assert.equal(noted.code, 200, noted.body.error);
  const slot = () =>
    status().then((s) =>
      s.openRound.pages.find((item) => item.id === "detail"),
    );
  const drafting = await slot();
  assert.equal(drafting.state, "active");
  assert.ok(drafting.startedAt);
  assert.equal(drafting.note.text, "Drafting");
  const after = (await status()).report;
  assert.equal(after.note, "Reading");
  assert.equal(after.noteAt, before.noteAt);
  assert.ok(Date.parse(after.at) >= Date.parse(before.at));
  await publish("1", "overview", "Overview", "<p>x</p>");
  assert.equal((await slot()).note.text, "Drafting");
  await publish("1", "detail", "Detail", "<p>x</p>");
  const published = await slot();
  assert.equal(published.state, "ready");
  assert.equal(published.note, undefined);
});

test("a page note is refused before Agreed, on an unknown page and on a published page", async (t) => {
  const { a, publish } = await session(t);
  const refusal = async (data) => (await a.action("ack", data)).body.error;
  assert.equal(
    await refusal({ note: "Reading", page: "detail" }),
    "Publish Agreed before a page note",
  );
  await publish(
    "1",
    "agreed",
    "Agreed so far",
    undefined,
    {},
    {
      pages: firstPages,
      start: ["detail"],
    },
  );
  assert.equal(
    await refusal({ page: "detail" }),
    "A note on a page takes its text with --note",
  );
  assert.equal(
    await refusal({ note: "Reading", page: "nope" }),
    "Unknown page nope in round 1",
  );
  await publish("1", "overview", "Overview", "<p>x</p>");
  assert.equal(
    await refusal({ note: "Reading", page: "overview" }),
    "Page overview is already published",
  );
});

// pair progress --note sends the ack action.
test("the ack action says the agent has a submission without reading it, and carries a note", async (t) => {
  const h = await testHub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const event = a.event();
  await a.feedback(event);
  const ack = await a.action("ack", { note: "  Reading your feedback  " });
  assert.equal(ack.code, 200);
  assert.deepEqual(ack.body.received, {
    id: event.id,
    intent: "feedback-only",
  });
  assert.equal(ack.body.status.lastReceivedId, event.id);
  assert.equal(ack.body.status.report.note, "Reading your feedback");
  assert.ok(ack.body.next.includes(`pair read --session-dir ${a.directory}`));
  // The ack action does not mark the submission read, so the hub still refuses
  // the next publish.
  assert.deepEqual(ack.body.status.acknowledged, []);
  assert.equal((await a.publish(planData("2"))).code, 409);
  for (const note of ["x".repeat(81), 3])
    assert.equal((await a.action("ack", { note })).code, 400);
  const read = await a.action("read");
  assert.equal(read.body.event.id, event.id);
  // The hub clears the note on any other report, so the progress card never
  // shows a stale note.
  assert.equal(read.body.status.report.note, null);
  assert.match(read.body.next, /publish Agreed with the round's page list/);
  const published = await a.publish(planData("2"));
  assert.equal(published.body.roundComplete, true);
  assert.match(published.body.next, /^You published round 2\./);
});

// The hub never replaces a published page, so it checks a page's links when the
// page publishes. If the hub found a bad link only when the round completes,
// the round could never complete.
test("a page's links are checked as it publishes, not when the round completes", async (t) => {
  const h = await testHub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  await a.feedback(a.event());
  await a.action("read");
  const refused = await a.publish({
    ...planData("2"),
    pages: [
      { id: "overview", title: "Overview", html: '<a href="#nowhere">x</a>' },
      { id: "details", title: "Details", html: "<p>Detail.</p>" },
    ],
  });
  assert.equal(refused.code, 400);
  assert.equal(
    refused.body.error,
    `page "overview": link "#nowhere" names no page of the round and no element on this page. The round's pages are agreed, overview and details.`,
  );
  const records = await fs.readdir(path.join(a.directory, "pages", "2"));
  assert.deepEqual(
    records.map((file) => file.split(".")[0]),
    ["agreed"],
  );
});

// The hub assembles a round from its stored pages at each publish. A page that
// an older pair build checked can break a rule added since, and the hub must
// still complete that page's round.
test("a page built before the bare < check was added still completes its round", async (t) => {
  const { a, page, publish, firstAgreed } = await session(t);
  const bare = '<pre data-language="ts">first<T>()</pre>';
  await assert.rejects(
    page("1", "overview", "Overview", bare),
    /the ts code block has a < that the browser reads as a tag on line 1/,
  );
  // older is the file that an older pair build wrote for the same source.
  const built = await page("1", "overview", "Overview", "<p>x</p>");
  const record = pageData(built);
  record.page.html = bare;
  const older = built.replace(
    /(<script type="application\/json" id="page-data">)[\s\S]*?(<\/script>)/,
    (_, start, end) =>
      start + JSON.stringify(record).replaceAll("<", "\\u003c") + end,
  );
  assert.equal((await firstAgreed()).code, 200);
  const stored = await a.action("publish", { html: older });
  assert.equal(stored.code, 200, stored.body.error);
  const last = await publish("1", "detail", "Detail", "<p>Detail</p>");
  assert.equal(last.code, 200, last.body.error);
  assert.equal(last.body.roundComplete, true);
});

test("a page may link to a page of its round that publishes after it", async (t) => {
  const h = await testHub(t);
  const a = await h.session();
  const published = await a.publish({
    ...planData(),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: '<a href="#details">Details</a>',
      },
      { id: "details", title: "Details", html: '<a href="#overview">Back</a>' },
    ],
  });
  assert.equal(published.code, 200);
  assert.equal(published.body.roundComplete, true);
});

// Between rounds, page progress refuses for one of two reasons: the last round
// has every page published, or the next round has no Agreed yet.
test("page progress between rounds says the round is finished, or that Agreed is next", async (t) => {
  const h = await testHub(t);
  const a = await h.session();
  const progress = () => a.action("progress", { start: ["overview"] });
  assert.equal((await a.publish(planData())).code, 200);
  const finished = await progress();
  assert.equal(finished.code, 409);
  assert.match(
    finished.body.error,
    /^Every page of round 1 is published, so the round has no page to start\. You published round 1\. /,
  );
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.match(
    (await progress()).body.error,
    /no page to start\. Run pair read --session-dir /,
  );
  assert.equal((await a.action("read")).code, 200);
  const early = await progress();
  assert.equal(early.code, 409);
  assert.equal(early.body.error, "Publish Agreed first");
  assert.equal((await a.status()).body.openRound, null);
});
