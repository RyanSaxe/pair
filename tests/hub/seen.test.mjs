import assert from "node:assert/strict";
import test from "node:test";
import { startHub } from "../../src/hub/server.mjs";
import { hub, planData } from "../support/hub.mjs";

// Every browser on the hub reads the seen record with the session list and adds
// to it with POST /api/seen. A phone on PAIR_HUB_HOST and a computer therefore
// share one record.
test("browsers share what the reviewer cleared, opened and saw, and a new hub keeps it", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const list = async (origin = h.server.origin) =>
    (await (await fetch(`${origin}/api/sessions`)).json()).seen;
  // The hub reports each list as null until a browser sends one.
  assert.deepEqual(await list(), { cleared: null, opened: null, cards: null });
  const [entry] = (await a.request("/api/sessions")).body.sessions;
  const event = entry.events[0].id;
  const page = `${a.id}/1/overview`;
  const card = `${a.id}/tidy`;
  const added = await a.request("/api/seen", {
    cleared: [event],
    opened: [page],
    cards: [],
  });
  assert.equal(added.code, 200);
  const expected = { cleared: [event], opened: [page], cards: [] };
  assert.deepEqual(added.body, expected);
  await a.request("/api/seen", { cards: [card], opened: [page] });
  expected.cards = [card];
  assert.deepEqual(await list(), expected);
  await h.server.close();
  const next = await startHub(h.config);
  t.after(next.close);
  assert.deepEqual(await list(next.origin), expected);
});

test("the record refuses another site's page and a body that is not lists of IDs", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData());
  const page = `${a.id}/1/overview`;
  const refused = await a.request(
    "/api/seen",
    { opened: [page] },
    { Origin: "http://evil" },
  );
  assert.equal(refused.code, 403);
  for (const body of [{ opened: page }, { opened: [1] }, { places: [page] }])
    assert.equal((await a.request("/api/seen", body)).code, 400);
  assert.equal((await a.request("/api/sessions")).body.seen.opened, null);
});

test("the record drops what the session list no longer shows", async (t) => {
  const h = await hub(t);
  const a = await h.session(),
    b = await h.session();
  await a.publish(planData());
  await b.publish(planData());
  const events = (await a.request("/api/sessions")).body.sessions.flatMap(
    (entry) => entry.events.map(({ id }) => id),
  );
  await a.request("/api/seen", {
    cleared: [...events, "gone"],
    opened: [`${a.id}/1/overview`, `${b.id}/1/overview`],
    cards: [`${a.id}/tidy`, `${b.id}/tidy`],
  });
  // Round 2 replaces round 1, so the hub drops the round 1 page from opened.
  await a.feedback(a.event());
  await a.action("read");
  assert.equal((await a.publish(planData("2"))).code, 200);
  assert.equal((await b.request(`${b.base}/api/dismiss`, {})).code, 200);
  const { sessions, seen } = (await a.request("/api/sessions")).body;
  const listed = new Set(
    sessions.flatMap((entry) => entry.events.map(({ id }) => id)),
  );
  assert.deepEqual(seen, {
    cleared: events.filter((id) => listed.has(id)),
    opened: [],
    cards: [`${a.id}/tidy`],
  });
  assert.ok(seen.cleared.length);
});
