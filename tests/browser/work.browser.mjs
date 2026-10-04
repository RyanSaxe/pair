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

// The Work row's label, and each shown number with its title.
const workRow = (page) =>
  page.locator("#work-row").evaluate((row) => {
    const count = (kind) => {
      const mark = row.querySelector(`.count.${kind}`);
      return mark && !mark.hidden ? [mark.textContent, mark.title] : null;
    };
    return {
      label: row.getAttribute("aria-label"),
      needs: count("needs"),
      proposed: count("proposed"),
    };
  });

test("Start sends where the work runs and the message, and the card runs", async (t) => {
  const { session, page, tab, cards } = await work(t);
  if (!page) return;
  // With nothing started, Work opens on Proposed, and the Work row shows
  // the proposed number alone.
  await page
    .locator("#work-tab-proposed[aria-selected=true]")
    .waitFor({ timeout: 8000 });
  assert.deepEqual(await workRow(page), {
    label: "Work, 2 proposed",
    needs: null,
    proposed: ["2", "2 proposed"],
  });
  await page.locator("[data-proposal-card=deck] .proposal-start").click();
  const dialog = page.locator("#start-dialog");
  await dialog.locator("#start-title", { hasText: "Build the deck" }).waitFor();
  assert.equal(
    await dialog.locator("[data-where=here]").getAttribute("aria-checked"),
    "true",
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
    .locator("[data-proposal-card=deck] .card-state", { hasText: "Working" })
    .waitFor();
  // The Start answered the round, and the reader stays on Work.
  assert.equal(new URL(page.url()).hash, "#work");
});

// The choices, the message box and the button row keep their places
// whichever choice is selected, so the popup never changes size. Each
// choice's buttons sit in one row, on a desktop and on a 375px phone.
test("the Start popup keeps one size and one row of buttons", async (t) => {
  const { session, page } = await work(t);
  if (!page) return;
  const added = await session.action("propose", {
    ...card("flow", "Redraw the example flow diagram for the fluid model"),
    delivers:
      "guide/flow.svg and its copy in the test fixture drawing rounds, proposals, Start and closing, with no Accept or offers.",
    changes: "guide/flow.svg and tests/fixture/p-figures.html.",
    recommend: "sub-session",
  });
  assert.equal(added.code, 200, added.body.error);
  const rows = {
    here: ["#start-send"],
    "sub-session": ["#start-send"],
    "new-agent": ["#start-copy", "#start-open"],
  };
  for (const [width, height] of [
    [1280, 800],
    [375, 664],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator("[data-proposal-card=flow] .proposal-start").click();
    const dialog = page.locator("#start-dialog");
    await dialog
      .locator("#start-title", { hasText: "Redraw the example flow" })
      .waitFor();
    const boxes = [];
    for (const where of ["here", "sub-session", "new-agent", "here"]) {
      await dialog.locator(`[data-where=${where}]`).click();
      assert.equal(
        await dialog
          .locator(`[data-where=${where}]`)
          .getAttribute("aria-checked"),
        "true",
      );
      boxes.push(await dialog.boundingBox());
      const buttons = await Promise.all(
        rows[where].map((id) => dialog.locator(id).boundingBox()),
      );
      const copy = await dialog.locator("#start-copy").boundingBox();
      for (const button of buttons) {
        assert.equal(button.y, buttons[0].y, `${where} at ${width}px`);
        assert.equal(button.height, copy.height, `${where} at ${width}px`);
      }
    }
    for (const box of boxes) assert.deepEqual(box, boxes[0], `at ${width}px`);
    // Only the chosen row of buttons can be pressed.
    await dialog.locator("[data-where=new-agent]").click();
    assert.equal(await dialog.locator("#start-open").isVisible(), true);
    assert.equal(await dialog.locator("#start-send").isVisible(), false);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
});

test("Open a new agent session starts the card with a new agent and shows its thread", async (t) => {
  const { session, page, cards } = await work(t);
  if (!page) return;
  await page.locator("[data-proposal-card=export] .proposal-start").click();
  const dialog = page.locator("#start-dialog");
  await dialog.locator("[data-where=new-agent]").click();
  await dialog.locator("#start-message").fill("Use the board template.");
  await dialog.locator("#start-open").click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual((await cards())[1].started, "new-agent");
  // Work follows the card to Running, with the thread under it.
  await page
    .locator("[data-proposal-card=export] .card-state", {
      hasText: "Opening a new agent session",
    })
    .waitFor({ timeout: 5000 });
  await page
    .locator("pair-thread", { hasText: "Use the board template." })
    .waitFor({ timeout: 5000 });
  const { threads } = (await session.status()).body;
  assert.equal(threads[0].kind, "open-agent");
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

test("Work opens on Needs you when a card's sub-session waits for the reviewer", async (t) => {
  const h = await hub(t);
  const parent = await h.session({ start: true });
  assert.equal((await parent.publish(planData())).code, 200);
  const added = await parent.action("propose", {
    ...card("deck", "Build the deck"),
    recommend: "sub-session",
  });
  assert.equal(added.code, 200, added.body.error);
  const proposed = await parent.action(
    "propose",
    card("export", "Refresh the export"),
  );
  assert.equal(proposed.code, 200, proposed.body.error);
  const started = await parent.request(
    `${parent.base}/api/proposals/deck/start`,
    { where: "sub-session" },
  );
  assert.equal(started.code, 200, started.body.error);
  const child = await h.session({
    start: true,
    from: parent.directory,
    proposal: "deck",
  });
  assert.equal((await child.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${parent.base}/#work`);
  if (!page) return;
  // The card counts as running until the session listing says its
  // sub-session waits, so Work must not settle on Running before then.
  await page.locator('#work-tab-needs[aria-selected="true"]').waitFor();
  await page
    .locator("#work-cards [data-proposal-card=deck]")
    .waitFor({ timeout: 5000 });
  // The Work row shows both numbers, each saying what it counts.
  assert.deepEqual(await workRow(page), {
    label: "Work, 1 needs you, 1 proposed",
    needs: ["1", "1 needs you"],
    proposed: ["1", "1 proposed"],
  });
});
