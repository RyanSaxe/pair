import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../../src/cli/build.mjs";
import { pageData } from "../../../src/shared/records.mjs";
import { exists, hub, planData, sessionConfig } from "../../support/hub.mjs";

const card = {
  id: "deck",
  title: "Build the deck",
  delivers: "Twelve slides on Q3 pricing.",
  changes: "Only talks/q3/.",
  recommend: "here",
  reason: "It is one file.",
  source: "From the conversation",
};
// A session with rounds 1 and 2 published and one proposal. attach sends
// pair plan's action as the command does: each built page's record, and the
// pages' sources copied into the session's plans/ directory.
async function planning(t) {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  await a.feedback(a.event());
  await a.action("read");
  assert.equal((await a.publish(planData("2"))).code, 200);
  assert.equal((await a.action("propose", card)).code, 200);
  let count = 0;
  async function attach(pages, fields = {}) {
    const source = path.join(a.directory, "plans", `.source-${++count}`);
    const records = [];
    for (const page of pages) {
      await fs.mkdir(path.join(source, page.id), { recursive: true });
      await fs.writeFile(path.join(source, page.id, "page.html"), page.html);
      const html = await buildPage(path.join(source, "source.json"), {
        name: "example",
        round: "plan",
        title: "Example work",
        page,
      });
      records.push(pageData(html));
    }
    return a.action("plan", {
      proposal: card.id,
      rounds: "1-2",
      pages: pages.map(({ id, title }) => ({ id, title })),
      records,
      source,
      ...fields,
    });
  }
  const plans = path.join(a.directory, "plans");
  const kept = (...parts) => path.join(plans, card.id, ...parts);
  return { h, a, attach, plans, kept };
}
const overview = {
  id: "overview",
  title: "Overview",
  html: '<p>Twelve slides. See <a href="#steps">the steps</a>.</p>',
};
const steps = { id: "steps", title: "Steps", html: "<p>Build each slide.</p>" };

test("pair plan attaches a plan to a card, and a second one replaces it", async (t) => {
  const { a, attach, plans, kept } = await planning(t);
  const attached = await attach([overview, steps]);
  assert.equal(attached.code, 200, attached.body.error);
  assert.equal(attached.body.replaced, false);
  assert.equal(
    attached.body.url,
    `${a.info.url.replace(/\/$/, "")}/plans/deck/`,
  );
  const pages = [
    { id: "overview", title: "Overview" },
    { id: "steps", title: "Steps" },
  ];
  const { plan } = attached.body.proposal;
  assert.deepEqual(
    { ...plan, at: undefined },
    {
      at: undefined,
      round: "2",
      rounds: "1-2",
      pages,
    },
  );
  assert.deepEqual((await a.status()).body.proposals[0].plan, plan);
  assert.deepEqual(JSON.parse(await fs.readFile(kept("pages.json"), "utf8")), {
    pages,
  });
  assert.equal(
    await fs.readFile(kept("src", "steps", "page.html"), "utf8"),
    steps.html,
  );
  // The copy pair plan made is now the plan's source.
  assert.deepEqual(await fs.readdir(plans), ["deck"]);

  // The plan view is the plan, read-only, in the session.
  const view = await a.request(`${a.base}/plans/deck/`);
  assert.equal(view.code, 200);
  assert.deepEqual(sessionConfig(view.body), {
    sessionId: a.id,
    base: a.base,
    readonly: true,
  });
  assert.match(view.body, /Build each slide/);
  // Download is the same file as an attachment, with no session in it.
  const download = await a.request(`${a.base}/plans/deck/download`);
  assert.equal(download.code, 200);
  assert.equal(
    download.headers.get("content-disposition"),
    'attachment; filename="deck-plan.html"',
  );
  assert.deepEqual(sessionConfig(download.body), {});
  assert.equal(download.body, await fs.readFile(kept("plan.html"), "utf8"));

  const replaced = await attach([steps], { rounds: "2" });
  assert.equal(replaced.code, 200, replaced.body.error);
  assert.equal(replaced.body.replaced, true);
  assert.deepEqual(replaced.body.proposal.plan.pages, [pages[1]]);
  assert.equal(replaced.body.proposal.plan.rounds, "2");
  assert.equal(await exists(kept("src", "overview")), false);
  assert.doesNotMatch(
    (await a.request(`${a.base}/plans/deck/download`)).body,
    /Twelve slides\. See/,
  );
  assert.deepEqual(await fs.readdir(plans), ["deck"]);
});

test("pair plan refuses a round the session does not have, a declined or done card, and a page list the files do not match", async (t) => {
  const { a, attach, kept } = await planning(t);
  const refusals = [
    [{ rounds: "1-3" }, 400, /no round 3/],
    [{ rounds: "4" }, 400, /no round 4/],
    [{ rounds: "2-1" }, 400, /backwards/],
    [{ proposal: "none" }, 404, /No proposal none/],
  ];
  for (const [fields, code, error] of refusals) {
    const refused = await attach([overview, steps], fields);
    assert.equal(refused.code, code, JSON.stringify(fields));
    assert.match(refused.body.error, error);
  }
  const unmatched = await attach([steps], {
    pages: [{ id: "overview", title: "Overview" }],
  });
  assert.equal(unmatched.code, 400);
  assert.match(unmatched.body.error, /--file 1 is page steps/);
  // A link to a page the plan does not have.
  const linked = await attach([overview]);
  assert.equal(linked.code, 400);
  assert.match(linked.body.error, /"#steps" names no page/);
  assert.equal(await exists(kept()), false);

  const browser = (action, body = {}) =>
    a.request(`${a.base}/api/proposals/deck/${action}`, body);
  assert.equal((await browser("decline")).code, 200);
  const declined = await attach([steps]);
  assert.equal(declined.code, 409);
  assert.match(declined.body.error, /declined proposal deck/);
  assert.equal((await browser("restore")).code, 200);
  assert.equal((await browser("start", { where: "here" })).code, 200);
  // Work that runs can still take a plan, until it is done.
  assert.equal((await attach([steps])).code, 200);
  await a.action("read");
  assert.equal(
    (await a.action("propose", { id: "deck", done: true })).code,
    200,
  );
  const done = await attach([steps]);
  assert.equal(done.code, 409);
  assert.match(done.body.error, /deck is done/);
  assert.equal(
    (await a.request(`${a.base}/plans/none/`)).code,
    404,
    "no plan for a card that has none",
  );
});
