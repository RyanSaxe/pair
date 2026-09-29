import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import { pageData } from "../../../src/shared/records.mjs";
import { frameSource } from "../../support/frame.mjs";
import { planData, task, hub as testHub } from "../../support/hub.mjs";

// Each test registers its own session on its own hub, so no test depends on
// the rounds another one published.
async function session(t) {
  const h = await testHub(t);
  const registered = await h.session();
  const { directory, agent } = registered;
  const sessionId = registered.id;
  const hub = h.server;
  const post = async (route, body, headers = {}) => {
    const response = await fetch(hub.origin + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const act = (body) =>
    post(
      `/agent/${sessionId}/action`,
      { ...body, sessionId, agent },
      { authorization: `Bearer ${registered.connection.token}` },
    );
  const status = async () =>
    (await fetch(`${hub.origin}/s/${sessionId}/api/status`)).json();
  const page = async (round, id, title, html, extra = {}) =>
    buildPage(path.join(directory, "source.json"), {
      name: "page-test",
      round,
      ...(id === "agreed" ? { offer: "plan" } : {}),
      title: "Page test",
      page: {
        id,
        title,
        ...(id === "agreed" ? { agreements: [], task } : { html }),
        ...extra,
      },
    });
  const publish = async (round, id, title, html, extra, pages) =>
    act({
      action: "publish",
      html: await page(round, id, title, html, extra),
      ...(pages ? { pages } : {}),
    });
  // Round 1's Agreed, as the first test publishes it.
  const firstAgreed = () =>
    publish(
      "1",
      "agreed",
      "Agreed so far",
      undefined,
      { agreements: firstAgreements },
      firstPages,
    );
  return {
    hub,
    directory,
    sessionId,
    post,
    act,
    status,
    page,
    publish,
    firstAgreed,
  };
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
  const { hub, sessionId, act, status, page, publish } = await session(t);
  assert.equal((await publish("1", "agreed", "Agreed so far")).status, 400);
  assert.equal((await status()).current, null);
  assert.equal(
    (
      await publish("1", "agreed", "Agreed so far", undefined, {}, [
        firstPages[0],
        firstPages[0],
      ])
    ).status,
    400,
  );
  assert.equal((await status()).current, null);
  const result = await publish(
    "1",
    "agreed",
    "Agreed so far",
    undefined,
    { agreements: firstAgreements },
    firstPages,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.page.id, "agreed");
  assert.match(result.body.next, /^Pages still to publish: overview, detail\./);
  assert.equal((await status()).rounds.length, 0);
  const response = await fetch(`${hub.origin}/s/${sessionId}/`);
  const html = await response.text();
  assert.match(frameSource(html), /Agreed so far/);
  assert.match(html, /"pageMode":"partial"/);
  assert.match(html, /Detail/);
  const manifest = await (
    await fetch(`${hub.origin}/s/${sessionId}/api/page-set?round=1`)
  ).json();
  assert.deepEqual(
    manifest.pages.map((item) => item.id),
    ["agreed", "overview", "detail"],
  );
  assert.equal(manifest.pages[1].state, "queued");
  assert.equal(manifest.complete, false);
  assert.equal(
    (await publish("1", "detail", "Detail", "<p>x</p>", {}, firstPages)).status,
    400,
  );
  assert.equal(
    (await act({ action: "progress", start: ["missing"] })).status,
    409,
  );
  assert.equal(
    (
      await act({
        action: "publish",
        html: await page("1", "unlisted", "Unlisted", "<p>x</p>"),
      })
    ).status,
    409,
  );
  // The hub takes the round's offer from Agreed and refuses a page that
  // names one.
  const offered = await act({
    action: "publish",
    html: (await page("1", "overview", "Overview", "<p>x</p>")).replace(
      'id="page-data">{',
      'id="page-data">{"offer":"plan",',
    ),
  });
  assert.equal(offered.status, 400);
  assert.equal(
    offered.body.error,
    "page \"overview\" names an offer. Only Agreed's source names the round's offer.",
  );
});

test("a build round's next line has the agent mark a step before building it", async (t) => {
  const { directory, act } = await session(t);
  const html = await buildPage(path.join(directory, "source.json"), {
    name: "page-test",
    round: "1",
    offer: "finish",
    title: "Page test",
    page: { id: "agreed", title: "Agreed so far", agreements: [], task },
  });
  const result = await act({ action: "publish", html, pages: firstPages });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(
    result.body.next,
    /pair progress --start ID before you start the step that page shows/,
  );
});

test("listed pages arrive independently and only the last completes the round", async (t) => {
  const {
    hub,
    directory,
    sessionId,
    post,
    act,
    status,
    page,
    publish,
    firstAgreed,
  } = await session(t);
  // The hub lists the round's readable pages as each one publishes.
  const readyPages = async () =>
    (await (await fetch(`${hub.origin}/api/sessions`)).json()).sessions.find(
      (item) => item.id === sessionId,
    ).readyPages;
  await firstAgreed();
  assert.deepEqual(await readyPages(), { round: "1", ids: ["agreed"] });
  assert.equal(
    (await act({ action: "progress", start: ["detail"] })).status,
    200,
  );
  const before = await status();
  assert.equal(before.openRound.pages[1].state, "active");
  assert.equal(before.needsYou, false);
  const early = await post(
    `/s/${sessionId}/api/feedback`,
    {
      sessionId,
      id: "early",
      name: "page-test",
      round: "1",
      intent: "feedback-only",
      text: "Too early",
      groups: {},
    },
    { origin: hub.origin },
  );
  assert.equal(early.status, 409);
  const detail = await publish(
    "1",
    "detail",
    "Detail",
    "<p>Finished detail</p>",
  );
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.roundComplete, false);
  assert.deepEqual(await readyPages(), {
    round: "1",
    ids: ["agreed", "detail"],
  });
  const immutable = await fs.readFile(detail.body.page.recordPath, "utf8");
  assert.doesNotMatch(
    await (await fetch(`${hub.origin}/s/${sessionId}/`)).text(),
    /Finished detail/,
  );
  const manifest = await (
    await fetch(`${hub.origin}/s/${sessionId}/api/page-set?round=1`)
  ).json();
  const slot = manifest.pages.find((item) => item.id === "detail");
  assert.equal(slot.state, "ready");
  const recordResponse = await fetch(
    `${hub.origin}/s/${sessionId}/api/page?round=1&id=detail&version=${slot.version}`,
  );
  assert.equal(recordResponse.status, 200);
  assert.match((await recordResponse.json()).page.html, /Finished detail/);
  assert.equal(
    (
      await fetch(
        `${hub.origin}/s/${sessionId}/api/page?round=1&id=detail&version=${"0".repeat(64)}`,
      )
    ).status,
    404,
  );
  const valid = await page(
    "1",
    "overview",
    "Overview",
    "<p>Finished overview</p>",
  );
  const tampered = pageData(valid);
  tampered.page.html = "<h1>Duplicate heading</h1>";
  const failed = await act({
    action: "publish",
    html: valid.replace(
      /(<script type="application\/json" id="page-data">)[\s\S]*?(<\/script>)/,
      (_, start, end) =>
        start + JSON.stringify(tampered).replaceAll("<", "\\u003c") + end,
    ),
  });
  assert.equal(failed.status, 400);
  assert.equal(
    (await status()).current.sha256,
    detail.body.status.current.sha256,
  );
  const rounds = path.join(directory, "rounds");
  const held = path.join(directory, "rounds-held");
  await fs.rename(rounds, held);
  await fs.writeFile(rounds, "blocked");
  try {
    const writeFailure = await publish(
      "1",
      "overview",
      "Overview",
      "<p>Finished overview</p>",
    );
    assert.equal(writeFailure.status, 500);
    assert.equal(
      (await status()).current.sha256,
      detail.body.status.current.sha256,
    );
  } finally {
    await fs.unlink(rounds);
    await fs.rename(held, rounds);
  }
  const overview = await publish(
    "1",
    "overview",
    "Overview",
    "<p>Finished overview</p>",
  );
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  assert.equal(overview.body.roundComplete, true);
  assert.deepEqual(await readyPages(), {
    round: "1",
    ids: ["agreed", "overview", "detail"],
  });
  assert.equal((await status()).rounds.length, 1);
  assert.equal((await status()).openRound, null);
  assert.equal((await status()).needsYou, true);
  const completeSet = await (
    await fetch(`${hub.origin}/s/${sessionId}/api/page-set?round=1`)
  ).json();
  assert.equal(completeSet.complete, true);
  assert.equal(
    (await fetch(`${hub.origin}/s/${sessionId}/api/page-set?round=missing`))
      .status,
    404,
  );
  assert.equal(
    (
      await fetch(
        `${hub.origin}/s/${sessionId}/api/page?round=1&id=missing&version=${completeSet.pages[0].version}`,
      )
    ).status,
    404,
  );
  assert.equal(
    await fs.readFile(detail.body.page.recordPath, "utf8"),
    immutable,
  );
  assert.equal(
    (await publish("1", "detail", "Detail", "<p>again</p>")).status,
    409,
  );
});

test("the next round may choose unrelated pages without changing history", async (t) => {
  const { hub, sessionId, post, act, status, publish, firstAgreed } =
    await session(t);
  await firstAgreed();
  await publish("1", "detail", "Detail", "<p>Finished detail</p>");
  await publish("1", "overview", "Overview", "<p>Finished overview</p>");
  const response = await post(
    `/s/${sessionId}/api/feedback`,
    {
      sessionId,
      id: "feedback-1",
      name: "page-test",
      round: "1",
      intent: "feedback-only",
      text: "Change topics",
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
    },
    { origin: hub.origin },
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal((await act({ action: "read" })).status, 200);
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
            { kind: "note", submissionId: "feedback-1", noteId: "note-1" },
          ],
        },
      ],
    },
    [
      { id: "overview", title: "Overview" },
      { id: "new-topic", title: "New topic" },
    ],
  );
  assert.equal(agreed.status, 200, JSON.stringify(agreed.body));
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
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(two.status, 200, JSON.stringify(two.body));
  const old = await (await fetch(`${hub.origin}/s/${sessionId}/r/1`)).text();
  const fresh = await (await fetch(`${hub.origin}/s/${sessionId}/`)).text();
  assert.match(old, /Finished detail/);
  assert.doesNotMatch(fresh, /Finished detail/);
  assert.match(fresh, /Fresh topic/);
  assert.equal((await status()).rounds.length, 2);
  assert.equal(
    (await fetch(`${hub.origin}/s/${sessionId}/api/page-set?round=1`)).status,
    200,
  );
});

test("a page note sits on its slot until the page publishes", async (t) => {
  const { act, publish, status } = await session(t);
  const pages = [...firstPages, { id: "steps", title: "Steps" }];
  const agreed = await publish(
    "1",
    "agreed",
    "Agreed so far",
    undefined,
    {},
    pages,
  );
  assert.equal(agreed.status, 200, JSON.stringify(agreed.body));
  assert.equal((await act({ action: "ack", note: "Reading" })).status, 200);
  const before = (await status()).report;
  const noted = await act({
    action: "ack",
    note: " Drafting ",
    page: "detail",
  });
  assert.equal(noted.status, 200, JSON.stringify(noted.body));
  const slot = () =>
    status().then((s) =>
      s.openRound.pages.find((item) => item.id === "detail"),
    );
  const drafting = await slot();
  assert.equal(drafting.state, "active");
  assert.ok(drafting.startedAt);
  assert.equal(drafting.note.text, "Drafting");
  // The page note moves the round's report time and keeps the Background note.
  const after = (await status()).report;
  assert.equal(after.note, "Reading");
  assert.equal(after.noteAt, before.noteAt);
  assert.ok(Date.parse(after.at) >= Date.parse(before.at));
  // Another page publishing leaves the note, and this page publishing ends it.
  await publish("1", "overview", "Overview", "<p>x</p>");
  assert.equal((await slot()).note.text, "Drafting");
  await publish("1", "detail", "Detail", "<p>x</p>");
  const published = await slot();
  assert.equal(published.state, "ready");
  assert.equal(published.note, undefined);
});

test("a page note is refused before Agreed, on an unknown page and on a published page", async (t) => {
  const { act, publish } = await session(t);
  const refusal = async (data) =>
    (await act({ action: "ack", ...data })).body.error;
  assert.equal(
    await refusal({ note: "Reading", page: "detail" }),
    "Publish Agreed before a page note",
  );
  await publish("1", "agreed", "Agreed so far", undefined, {}, firstPages);
  assert.equal(await refusal({ page: "detail" }), "ack --page takes --note");
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

test("ack says the agent has a submission without reading it, and carries a note", async (t) => {
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
  assert.match(
    ack.body.next,
    /^Run pair guide round\.md and read all it prints, then run: pair read --session-dir /,
  );
  // Receiving is not reading: the submission stays unread, so publish waits.
  assert.deepEqual(ack.body.status.acknowledged, []);
  assert.equal((await a.publish(planData("2"))).code, 409);
  for (const note of ["x".repeat(81), 3])
    assert.equal((await a.action("ack", { note })).code, 400);
  const read = await a.action("read");
  assert.equal(read.body.event.id, event.id);
  // Any other report clears the note, so the card never shows a stale one.
  assert.equal(read.body.status.report.note, null);
  assert.match(read.body.next, /publish Agreed with pair publish --pages/);
  const published = await a.publish(planData("2"));
  assert.equal(published.body.roundComplete, true);
  assert.match(published.body.next, /^Round 2 is published\./);
});

// A page cannot change once it is published, so a bad link has to be found
// before then, or the round could never complete.
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
    'page "overview": link "#nowhere" names no page',
  );
  const records = await fs.readdir(path.join(a.directory, "pages", "2"));
  assert.deepEqual(records.map((file) => file.split(".")[0]).sort(), [
    "agreed",
    "frame",
  ]);
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

test("page progress cannot start before Agreed for the next round", async (t) => {
  const h = await testHub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  assert.equal((await a.feedback(a.event())).code, 200);
  const result = await a.action("progress", { start: ["overview"] });
  assert.equal(result.code, 409);
  assert.equal((await a.status()).body.openRound, null);
});

test("a round keeps only its complete file, and a refused page leaves no record", async (t) => {
  const h = await testHub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  assert.deepEqual(await fs.readdir(path.join(a.directory, "rounds")), [
    "example.1.html",
  ]);
  await a.feedback(a.event());
  await a.action("read");
  // The last page completes the round, and the complete round refuses a
  // link to a page it does not have.
  const refused = await a.publish({
    ...planData("2"),
    pages: [
      { id: "overview", title: "Overview", html: '<a href="#nowhere">x</a>' },
    ],
  });
  assert.equal(refused.code, 400);
  assert.match(refused.body.error, /link "#nowhere" names no page/);
  const records = await fs.readdir(path.join(a.directory, "pages", "2"));
  assert.deepEqual(records.map((file) => file.split(".")[0]).sort(), [
    "agreed",
    "frame",
  ]);
});
