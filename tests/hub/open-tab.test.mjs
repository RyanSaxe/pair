import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { hub, planData, sleep, task } from "../support/hub.mjs";

test("a new session's first Agreed says to open the URL only when no tab polled the session list within the window", async (t) => {
  const h = await hub(t, {}, { tabWindowMs: 1000 });
  const build = (session, round, page) => {
    const { name, title } = planData(round);
    return buildPage(path.join(session.directory, "source.json"), {
      name,
      round,
      title,
      page,
    });
  };
  const publish = async (session, html, pages) => {
    const result = await session.action("publish", {
      html,
      ...(pages ? { pages: [{ id: "overview", title: "Overview" }] } : {}),
    });
    assert.equal(result.code, 200, result.body.error);
    return result.body.next;
  };
  const agreed = (session, round = "1") =>
    build(session, round, {
      id: "agreed",
      title: "Agreed so far",
      task,
      agreements: [],
    });
  // The next line names the session's URL whenever it is a first Agreed, and
  // starts by opening it only when no tab polled within the window.
  const opens = (session, next) => next.startsWith(`Open ${session.info.url} `);
  const a = await h.session(),
    b = await h.session(),
    c = await h.session();
  // Each Agreed is built before the poll, so only the publish runs inside
  // the window.
  const [first, second, third] = await Promise.all(
    [a, b, c].map((session) => agreed(session)),
  );
  assert.ok(opens(a, await publish(a, first, true)));
  await fetch(`${h.server.origin}/api/sessions`);
  const linked = await publish(b, second, true);
  assert.ok(!opens(b, linked) && linked.includes(b.info.url), linked);
  await sleep(1100);
  assert.ok(opens(c, await publish(c, third, true)));
  // A later round's Agreed says nothing about the browser.
  await publish(
    b,
    await build(b, "1", {
      id: "overview",
      title: "Overview",
      html: "<p>x</p>",
    }),
  );
  assert.equal((await b.feedback(b.event())).code, 200);
  assert.equal((await b.action("read")).code, 200);
  const later = await publish(b, await agreed(b, "2"), true);
  assert.ok(!later.includes(b.info.url), later);
});
