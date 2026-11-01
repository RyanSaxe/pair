import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const page = (id, title, html) => ({ id, title, html });

async function searcher(t) {
  const h = await hub(t);
  const find = async (query, params = {}) => {
    const address = new URL("/api/search", h.server.origin);
    address.searchParams.set("q", query);
    for (const [key, value] of Object.entries(params))
      address.searchParams.set(key, value);
    const response = await fetch(address);
    return { code: response.status, body: await response.json() };
  };
  // A new session's first read runs in the background, and the response says so
  // until it finishes.
  const settled = () =>
    waitUntil(async () => !(await find("settling")).body.loading);
  return { h, find, settled };
}

async function twoSessions(t) {
  const { h, find, settled } = await searcher(t);
  const a = await h.session();
  const b = await h.session();
  const published = await a.publish({
    ...planData(),
    pages: [
      page("overview", "Overview", "<p>Round one of the kestrel work.</p>"),
    ],
  });
  assert.equal(published.code, 200, published.body.error);
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal((await a.action("read")).code, 200);
  assert.equal(
    (
      await a.publish({
        ...planData("2"),
        pages: [
          page("overview", "Overview", "<p>Round two of the kestrel plan.</p>"),
        ],
      })
    ).code,
    200,
  );
  assert.equal(
    (
      await b.publish({
        ...planData(),
        pages: [
          page("overview", "Overview", "<p>Another kestrel, elsewhere.</p>"),
        ],
      })
    ).code,
    200,
  );
  assert.equal(
    (
      await a.request(`${a.base}/api/threads`, {
        id: crypto.randomUUID(),
        round: "2",
        topic: "overview",
        anchor: "Overview",
        text: "Which kestrel do you mean?",
      })
    ).code,
    201,
  );
  await settled();
  return { h, find, a, b };
}

test("session, round and kinds each narrow a search, and counts ignore kinds", async (t) => {
  const { find, a, b } = await twoSessions(t);
  const where = (body) =>
    body.results.map(
      (row) => `${row.session === a.id ? "a" : "b"}${row.round}`,
    );
  const all = await find("kestrel");
  assert.equal(all.code, 200);
  assert.equal(all.body.total, 4);
  assert.deepEqual(where(all.body).sort(), ["a1", "a2", "a2", "b1"]);
  const here = await find("kestrel", { session: a.id });
  assert.deepEqual(where(here.body).sort(), ["a1", "a2", "a2"]);
  const other = await find("kestrel", { session: b.id });
  assert.deepEqual(where(other.body), ["b1"]);
  const round = await find("kestrel", { session: a.id, round: "1" });
  assert.deepEqual(where(round.body), ["a1"]);
  const latest = await find("kestrel", { round: "latest" });
  assert.deepEqual(where(latest.body).sort(), ["a2", "a2", "b1"]);
  const threads = await find("kestrel", { kinds: "threads" });
  assert.deepEqual(where(threads.body), ["a2"]);
  assert.equal(threads.body.counts.pages, 3);
  assert.equal(threads.body.counts.threads, 1);
  const both = await find("kestrel", { kinds: "threads,pages" });
  assert.equal(both.body.total, 4);
  const sessions = await find("kestrel", { session: `${a.id},${b.id}` });
  assert.equal(sessions.body.total, 4);
  const rounds = await find("kestrel", { session: a.id, round: "1,2" });
  assert.deepEqual(where(rounds.body).sort(), ["a1", "a2", "a2"]);
  const oneAndLatest = await find("kestrel", { round: "1,latest" });
  assert.equal(oneAndLatest.body.total, 4);
});

test("limit caps the rows and total still counts them all", async (t) => {
  const { find } = await twoSessions(t);
  const limited = await find("kestrel", { limit: "2" });
  assert.equal(limited.body.results.length, 2);
  assert.equal(limited.body.total, 4);
  assert.equal((await find("kestrel", { limit: "0" })).code, 400);
  assert.equal((await find("kestrel", { kinds: "secrets" })).code, 400);
});

test("this session's rows rank first when the search says where it came from", async (t) => {
  const { find, a, b } = await twoSessions(t);
  for (const session of [a, b]) {
    const { results } = (await find("kestrel", { here: session.id })).body;
    assert.equal(results[0].session, session.id);
  }
});

test("a search that finds nothing names the first filter worth loosening", async (t) => {
  const { find, a, b } = await twoSessions(t);
  const threads = await find("elsewhere", { kinds: "threads", session: b.id });
  assert.deepEqual(threads.body.wider, { filter: "kinds", total: 1 });
  const rounds = await find("round one", { session: a.id, round: "latest" });
  assert.equal(rounds.body.wider.filter, "rounds");
  const sessions = await find("elsewhere", { session: a.id });
  assert.deepEqual(sessions.body.wider, { filter: "sessions", total: 1 });
  assert.equal((await find("zzzqqq")).body.wider, null);
});

test("nothing typed lists the newest things in scope", async (t) => {
  const { find, a } = await twoSessions(t);
  const { body } = await find("", { session: a.id });
  assert.ok(body.total > 0);
  assert.ok(body.results.every((row) => row.text));
  assert.equal(body.results[0].kind, "threads");
});

test("a write through each route is searchable right after it answers", async (t) => {
  const { h, find, settled } = await searcher(t);
  const a = await h.session();
  await settled();
  const finds = async (word) => (await find(word)).body.total > 0;
  const steps = [
    [
      "publish",
      "merlin",
      () =>
        a.publish({
          ...planData(),
          pages: [page("overview", "Overview", "<p>The merlin page.</p>")],
        }),
    ],
    [
      "thread",
      "peregrine",
      () =>
        a.request(`${a.base}/api/threads`, {
          id: "11111111-1111-4111-8111-111111111111",
          round: "1",
          topic: "overview",
          anchor: "Overview",
          text: "What about the peregrine?",
        }),
    ],
    [
      "agent reply",
      "goshawk",
      async () => {
        const note = "11111111-1111-4111-8111-111111111111";
        await a.action("reply", { note });
        return a.action("reply", { note, text: "The goshawk stays." });
      },
    ],
    [
      "reviewer reply",
      "harrier",
      () =>
        a.request(
          `${a.base}/api/threads/11111111-1111-4111-8111-111111111111/messages`,
          { id: crypto.randomUUID(), text: "And the harrier?" },
        ),
    ],
    [
      "draft",
      "buzzard",
      () =>
        a.request(`${a.base}/api/draft`, {
          changes: {
            "note/n1": {
              id: "n1",
              round: "1",
              topic: "overview",
              anchor: "Overview",
              text: "A buzzard note.",
            },
          },
        }),
    ],
    [
      "proposal",
      "condor",
      () =>
        a.action("propose", {
          id: "condor-work",
          title: "Condor work",
          delivers: "A condor.",
          why: "Reasons.",
          recommend: "here",
          agent: a.agent,
        }),
    ],
    [
      "feedback",
      "osprey",
      () =>
        a.feedback(a.event("feedback-only", "1", { message: "An osprey." })),
    ],
  ];
  for (const [name, word, write] of steps) {
    assert.equal(await finds(word), false, name);
    const { code, body } = await write();
    assert.ok(code < 300, `${name}: ${body.error}`);
    assert.equal(await finds(word), true, name);
  }
});

test("a response holds no token and no session directory", async (t) => {
  const { find, a } = await twoSessions(t);
  const { body } = await find("kestrel");
  const text = JSON.stringify(body);
  assert.ok(!text.includes(a.connection.token));
  assert.ok(!text.includes(a.directory));
  assert.equal((await find(a.connection.token)).body.total, 0);
});

test("a closed session stays out until a search asks for it or names it", async (t) => {
  const { find, b, h } = await twoSessions(t);
  assert.equal((await b.request(`${b.base}/api/dismiss`, {})).code, 200);
  const live = await find("elsewhere");
  assert.equal(live.body.total, 0);
  assert.deepEqual(live.body.wider, { filter: "closed", total: 1 });
  const asked = await find("elsewhere", { closed: "1" });
  assert.equal(asked.body.results[0].closed, true);
  assert.equal((await find("elsewhere", { session: b.id })).body.total, 1);
  const { sessions } = await (
    await fetch(`${h.server.origin}/api/search/sessions`)
  ).json();
  assert.equal(sessions.find(({ id }) => id === b.id).closed, true);
  const other = sessions.find(({ id }) => id !== b.id);
  assert.deepEqual(other.rounds, ["2", "1"]);
});

test("a closed round that never finished shows the pages it published", async (t) => {
  const { h, settled } = await searcher(t);
  const a = await h.session();
  const published = await a.publish({
    ...planData(),
    pages: [
      page("sent", "Sent", "<p>The published otter.</p>"),
      page("unsent", "Unsent", "<p>Never published.</p>"),
    ],
    stopAfter: 1,
  });
  assert.equal(published.code, 200, published.body.error);
  await settled();
  assert.equal((await a.request(`${a.base}/api/dismiss`, {})).code, 200);
  for (const address of [`${a.base}/r/1`, `${a.base}/`]) {
    const text = await (await fetch(h.server.origin + address)).text();
    assert.match(text, /published otter/);
    assert.doesNotMatch(text, /"unsent"/);
  }
});
