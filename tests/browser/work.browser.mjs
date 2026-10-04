import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const card = (id, title) => ({
  id,
  title,
  delivers: `${title}, delivered.`,
  changes: "One file.",
  recommend: "here",
  reason: "It is small.",
  source: "From the conversation",
});
// A session with round 1 waiting for the reviewer and two proposals, open
// on Work.
async function work(t) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  for (const [id, title] of [
    ["deck", "Build the deck"],
    ["export", "Refresh the export"],
  ]) {
    const added = await session.action("propose", card(id, title));
    assert.equal(added.code, 200, added.body.error);
  }
  const page = await open(t, `${h.server.origin}${session.base}/#work`);
  const tab = (id) => page.locator(`#work-tab-${id}`);
  const cards = async () =>
    (await session.status()).body.proposals.map(
      ({ id, started, declined }) => ({
        id,
        started: started?.where || null,
        declined: Boolean(declined),
      }),
    );
  return { session, page, tab, cards };
}

test("Start sends where the work runs and the message, and the card runs", async (t) => {
  const { session, page, tab, cards } = await work(t);
  if (!page) return;
  // With nothing started, Work opens on Proposed.
  await page
    .locator("#work-tab-proposed[aria-selected=true]")
    .waitFor({ timeout: 8000 });
  await page.locator("[data-proposal-card=deck] .proposal-start").click();
  const dialog = page.locator("#start-dialog");
  await dialog.locator("#start-title", { hasText: "Build the deck" }).waitFor();
  assert.equal(
    await dialog.locator("[data-where=here]").getAttribute("aria-checked"),
    "true",
  );
  assert.equal(
    await dialog.locator("[data-where=new-agent]").isDisabled(),
    true,
  );
  await dialog.locator("#start-message").fill("Keep the header height.");
  await dialog.locator("#start-send").click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await waitUntil(async () => (await cards())[0].started === "here"),
    true,
  );
  const status = (await session.status()).body;
  assert.equal(status.proposals[0].started.message, "Keep the header height.");
  await tab("running").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("proposed").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("running").click();
  await page
    .locator("[data-proposal-card=deck] .tag", { hasText: "Working" })
    .waitFor();
  // The Start answered the round, and the reader stays on Work.
  assert.equal(new URL(page.url()).hash, "#work");
});

test("Decline takes a card out of Proposed, and Restore puts it back", async (t) => {
  const { page, tab, cards } = await work(t);
  if (!page) return;
  const proposed = page.locator("#work-cards [data-proposal-card]");
  await proposed.nth(1).waitFor({ timeout: 8000 });
  await page
    .locator("[data-proposal-card=export] .link-btn", { hasText: "Decline" })
    .click();
  await tab("proposed").locator(".work-count", { hasText: "1" }).waitFor();
  assert.deepEqual(
    await proposed.evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.proposalCard),
    ),
    ["deck"],
  );
  assert.deepEqual(
    (await cards()).map(({ id, declined }) => [id, declined]),
    [
      ["deck", false],
      ["export", true],
    ],
  );
  await tab("done").click();
  await page
    .locator("[data-proposal-card=export] .link-btn", { hasText: "Restore" })
    .click();
  await tab("proposed").locator(".work-count", { hasText: "2" }).waitFor();
  assert.equal((await cards())[1].declined, false);
});
