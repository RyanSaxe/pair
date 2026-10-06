import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import {
  quietItems,
  quietStep,
  quietWake,
} from "../../../src/hub/session/quiet.mjs";
import { hub, literal, sleep, task, waitUntil } from "../../support/hub.mjs";

const minute = 60_000;
const tenMinutes = 10 * minute;
const now = Date.parse("2026-10-06T12:00:00.000Z");
const ago = (ms) => new Date(now - ms).toISOString();
const directory = "/state/pair/sessions/s1";

test("a started page and a card started here are quiet after 10 minutes with no update", () => {
  const state = {
    openRound: {
      pages: [
        {
          id: "ci-flakes",
          state: "active",
          startedAt: ago(30 * minute),
          note: { text: "Reading logs", at: ago(14 * minute) },
        },
        {
          id: "fresh",
          state: "active",
          startedAt: ago(30 * minute),
          note: { text: "x", at: ago(tenMinutes) },
        },
        { id: "unnoted", state: "active", startedAt: ago(tenMinutes + 1) },
        { id: "published", state: "ready", startedAt: ago(30 * minute) },
        { id: "listed", state: "ready" },
      ],
    },
    proposals: [
      {
        id: "node20-hang",
        started: { where: "here", at: ago(30 * minute) },
        status: {
          at: ago(12 * minute),
          parts: [
            { text: "Repro", state: "done" },
            { text: "Fix", state: "left" },
          ],
        },
        done: null,
      },
      {
        id: "no-parts",
        started: { where: "here", at: ago(11 * minute) },
        done: null,
      },
      {
        id: "all-parts-done",
        started: { where: "here", at: ago(30 * minute) },
        status: {
          at: ago(20 * minute),
          parts: [
            { text: "Build", state: "done" },
            { text: "Chart", state: "dropped" },
          ],
        },
        done: null,
      },
      {
        id: "recent",
        started: { where: "here", at: ago(30 * minute) },
        status: { at: ago(minute) },
        done: null,
      },
      {
        id: "finished",
        started: { where: "here", at: ago(30 * minute) },
        done: { at: ago(20 * minute) },
      },
      {
        id: "elsewhere",
        started: { where: "sub-session", at: ago(30 * minute) },
        done: null,
      },
      { id: "proposed", started: null, done: null },
    ],
  };
  assert.deepEqual(
    quietItems(state, now, tenMinutes).map(({ kind, id, updated }) => [
      kind,
      id,
      updated,
    ]),
    [
      ["page", "ci-flakes", true],
      ["page", "unnoted", false],
      ["proposal", "node20-hang", true],
      ["proposal", "no-parts", false],
    ],
  );
  assert.deepEqual(
    quietItems({ openRound: null, proposals: [] }, now, tenMinutes),
    [],
  );
});

test("the next-step line and the wake line name the quiet work and the commands that update it", () => {
  const both = [
    { kind: "page", id: "ci-flakes", updated: true, at: ago(14 * minute) },
    {
      kind: "proposal",
      id: "node20-hang",
      updated: true,
      at: ago(12 * minute),
    },
  ];
  assert.equal(
    quietStep(both, now, tenMinutes, directory),
    `No update in 10 minutes: page ci-flakes (last note 14 minutes ago), proposal node20-hang (parts last changed 12 minutes ago). Post a note on each page you are still working on with pair progress --session-dir ${directory} --page ID --note "…", and mark each finished part with pair propose --session-dir ${directory} --id ID --status-done "…".`,
  );
  assert.equal(
    quietWake(both, tenMinutes, directory),
    `pair: no pair command has run in session ${directory} for 10 minutes, and these have had no update in that time: page ci-flakes, proposal node20-hang. Between your current steps, post a note on each page you are still working on with pair progress --session-dir ${directory} --page ID --note "…", and mark each finished part with pair propose --session-dir ${directory} --id ID --status-done "…", then go on with your work. Leave a card that waits for the reviewer as it is.`,
  );
  // Each line names only the command for the kinds of work that are quiet.
  const card = [
    {
      kind: "proposal",
      id: "node20-hang",
      updated: false,
      at: ago(11 * minute),
    },
  ];
  assert.equal(
    quietStep(card, now, tenMinutes, directory),
    `No update in 10 minutes: proposal node20-hang (started 11 minutes ago). Mark each finished part with pair propose --session-dir ${directory} --id ID --status-done "…".`,
  );
  const page = [
    { kind: "page", id: "ci-flakes", updated: false, at: ago(11 * minute) },
  ];
  assert.equal(
    quietWake(page, tenMinutes, directory),
    `pair: no pair command has run in session ${directory} for 10 minutes, and these have had no update in that time: page ci-flakes. Between your current steps, post a note on each page you are still working on with pair progress --session-dir ${directory} --page ID --note "…", then go on with your work.`,
  );
});

// A session on a hub whose work is quiet after quietMs, with round 1's
// Agreed published and its two pages listed.
async function openRound(t, quietMs) {
  const h = await hub(t, {}, { quietMs, quietCheckMs: 20 });
  const a = await h.session();
  const agreed = await a.action("publish", {
    html: await buildPage(path.join(a.directory, "source.json"), {
      name: "example",
      round: "1",
      title: "Example work",
      page: { id: "agreed", title: "Agreed so far", task, agreements: [] },
    }),
    pages: [
      { id: "ci-flakes", title: "CI flakes" },
      { id: "docs-pass", title: "Docs pass" },
    ],
  });
  assert.equal(agreed.code, 200, agreed.body.error);
  const run = async (action, data) => {
    const result = await a.action(action, data);
    assert.equal(result.code, 200, result.body.error);
    return result.body;
  };
  const wakeLines = () =>
    a.inbox.wakes.map((wake) => wake.message.message.content);
  return { a, run, wakeLines };
}

test("every next step names quiet pages and cards until each gets an update", async (t) => {
  const quietMs = 300;
  const { a, run } = await openRound(t, quietMs);
  await run("progress", { start: ["ci-flakes"] });
  await run("propose", {
    id: "node20-hang",
    title: "Fix the Node 20 hang",
    delivers: "CI passes on Node 20.",
    recommend: "here",
  });
  await run("propose", { id: "node20-hang", start: "here", quote: "Fix it" });
  assert.equal((await run("status")).next.includes("\n"), false);
  await sleep(quietMs + 50);
  const dir = literal(a.directory);
  assert.match(
    (await run("status")).next,
    new RegExp(
      `\\nNo update in 0 minutes: page ci-flakes \\(started 0 minutes ago\\), proposal node20-hang \\(started 0 minutes ago\\)\\. Post a note on each page you are still working on with pair progress --session-dir ${dir} --page ID --note "…", and mark each finished part with pair propose --session-dir ${dir} --id ID --status-done "…"\\.$`,
    ),
  );
  await run("ack", { page: "ci-flakes", note: "Reading logs" });
  assert.match(
    (await run("status")).next,
    /\nNo update in 0 minutes: proposal node20-hang \(started 0 minutes ago\)\. Mark each/,
  );
  await run("propose", {
    id: "node20-hang",
    statusDone: ["Reproduced the hang"],
    statusLeft: ["Fix it"],
  });
  assert.equal((await run("status")).next.includes("\n"), false);
});

test("the hub wakes the holder once for quiet work when no command runs, and again only for an update or new work", async (t) => {
  const quietMs = 300;
  const { a, run, wakeLines } = await openRound(t, quietMs);
  await run("progress", { start: ["ci-flakes"] });
  // Commands that keep coming hold the wake back after the page is quiet.
  for (let elapsed = 0; elapsed < 2 * quietMs; elapsed += quietMs / 3) {
    await run("status");
    await sleep(quietMs / 3);
  }
  assert.deepEqual(wakeLines(), []);

  assert.equal(await waitUntil(() => wakeLines().length === 1), true);
  assert.match(
    wakeLines()[0],
    new RegExp(
      `^pair: no pair command has run in session ${literal(a.directory)} for 0 minutes, and these have had no update in that time: page ci-flakes\\. Between your current steps, post a note`,
    ),
  );
  // Another command leaves the page quiet, and the page is in no second wake.
  await run("status");
  await sleep(3 * quietMs);
  assert.equal(wakeLines().length, 1);

  // A page started since the wake sends one, which names both pages.
  await run("progress", { start: ["docs-pass"] });
  assert.equal(await waitUntil(() => wakeLines().length === 2), true);
  assert.match(
    wakeLines()[1],
    /had no update in that time: page ci-flakes, page docs-pass\./,
  );

  // A note on a page lets that page be in a wake again once it is quiet.
  await run("ack", { page: "ci-flakes", note: "Reading logs" });
  assert.equal(await waitUntil(() => wakeLines().length === 3), true);
  assert.match(
    wakeLines()[2],
    /had no update in that time: page ci-flakes, page docs-pass\./,
  );
  await sleep(3 * quietMs);
  assert.equal(wakeLines().length, 3);
});
