import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { buildPage } from "../../src/cli/build.mjs";
import { pageData } from "../../src/shared/records.mjs";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

const pages = [
  { id: "overview", title: "Overview", html: "<p>Twelve slides.</p>" },
  { id: "steps", title: "Steps", html: "<p>Build each slide.</p>" },
];
// A session with round 1 waiting for the reviewer and one proposal with a
// plan of two pages, attached as pair plan attaches it.
async function planned(t) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const proposed = await session.action("propose", {
    id: "deck",
    title: "Build the deck",
    delivers: "Twelve slides on Q3 pricing.",
    changes: "Only talks/q3/.",
    recommend: "here",
    reason: "It is one file.",
    source: "From the conversation",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const source = path.join(session.directory, "plans", ".source");
  const records = [];
  for (const page of pages) {
    await fs.mkdir(path.join(source, page.id), { recursive: true });
    const html = await buildPage(path.join(source, page.id, "page.json"), {
      name: "example",
      round: "plan",
      title: "Example work",
      page,
    });
    records.push(pageData(html));
  }
  const attached = await session.action("plan", {
    proposal: "deck",
    rounds: "1",
    pages: pages.map(({ id, title }) => ({ id, title })),
    records,
    source,
  });
  assert.equal(attached.code, 200, attached.body.error);
  return { h, session };
}

test("Open plan shows the plan's pages from its card, and Download saves a file that opens with no hub", async (t) => {
  const { h, session } = await planned(t);
  const page = await open(t, `${h.server.origin}${session.base}/#work`);
  if (!page) return;
  const card = page.locator("[data-proposal-card=deck]");
  await card
    .locator(".proposal-plan", {
      hasText: "Plan updated after round 1, from round 1.",
    })
    .waitFor({ timeout: 8000 });
  await card.locator(".tag", { hasText: "Plan" }).waitFor();
  await card.locator("a", { hasText: "Open plan" }).click();
  await page.waitForURL(/\/plans\/deck\//);
  // The plan's pages, with no Agreed, no Work, no Review and no round tabs.
  const listed = () =>
    page
      .locator("#page-list [data-page]")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent));
  await page.locator("#page-content", { hasText: "Twelve slides." }).waitFor();
  assert.deepEqual(await listed(), ["Overview", "Steps"]);
  assert.equal(await page.locator(".page-tabs").isVisible(), false);
  assert.equal(
    await page.locator("#sidebar .side-label > span").first().textContent(),
    "Plan",
  );
  assert.equal(
    await page.locator("#history-label").textContent(),
    "Work›Build the deck›Plan",
  );
  assert.equal(await page.locator("#submit").isVisible(), false);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#history-download").click(),
  ]);
  assert.equal(download.suggestedFilename(), "deck-plan.html");
  const file = path.join(h.home, "deck-plan.html");
  await download.saveAs(file);

  // With the hub stopped, the file shows the plan and asks nothing of it.
  await h.server.close();
  const requests = [];
  page.on("request", (request) => {
    if (request.url().startsWith(h.server.origin)) requests.push(request.url());
  });
  await page.goto(`${pathToFileURL(file).href}#steps`);
  await page
    .locator("#page-content", { hasText: "Build each slide." })
    .waitFor();
  assert.deepEqual(await listed(), ["Overview", "Steps"]);
  assert.equal(
    await page.locator("#history-label").textContent(),
    "Build the deck›Plan",
  );
  assert.equal(await page.locator("#history-download").isVisible(), false);
  assert.deepEqual(requests, []);
});
