import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { hub, literal, planData, sleep, task } from "../support/hub.mjs";

test("a new session's first Agreed says to open the URL only when no tab polled the session list within the window", async (t) => {
  const h = await hub(t, {}, { tabWindowMs: 1000 });
  const build = (session, round, page) =>
    buildPage(path.join(session.directory, "source.json"), {
      ...planData(round),
      page,
    });
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
  const opens = (session) =>
    new RegExp(
      `^Open ${literal(session.info.url)} in the user's default browser .*, and give the link in chat\\. Then: Pages still to publish: overview\\.`,
    );
  const a = await h.session(),
    b = await h.session(),
    c = await h.session();
  // Each Agreed is built before the poll, so only the publish runs inside
  // the window.
  const [first, second, third] = await Promise.all(
    [a, b, c].map((session) => agreed(session)),
  );
  assert.match(await publish(a, first, true), opens(a));
  await fetch(`${h.server.origin}/api/sessions`);
  assert.match(
    await publish(b, second, true),
    new RegExp(
      `^A pair tab is open in the user's browser, .* Give the link ${literal(b.info.url)} in chat, and do not open a tab\\. Then: Pages still to publish: overview\\.`,
    ),
  );
  await sleep(1100);
  assert.match(await publish(c, third, true), opens(c));
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
  assert.match(
    await publish(b, await agreed(b, "2"), true),
    /^Pages still to publish: overview\./,
  );
});
