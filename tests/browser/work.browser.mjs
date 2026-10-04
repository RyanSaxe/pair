import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const card = (id, title) => ({
  id,
  title,
  delivers: `${title}, delivered.`,
  recommend: "here",
});
// A session with round 1 waiting for the reviewer and two proposals, the
// first from round 1's Overview page, open on Work.
async function work(t) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  for (const [id, title, page] of [
    ["deck", "Build the deck", "1/overview"],
    ["export", "Refresh the export"],
  ]) {
    const added = await session.action("propose", { ...card(id, title), page });
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

test("Start sends where the work runs and the message, and the running card quotes the message", async (t) => {
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
  // The line under the card's title names the page the card came from and
  // links to it.
  const from = page.locator("[data-proposal-card=deck] .card-meta a");
  assert.equal(await from.textContent(), "From the Overview page");
  assert.equal(await from.getAttribute("href"), "#overview");
  await page.locator("[data-proposal-card=deck] .proposal-start").click();
  const dialog = page.locator("#start-dialog");
  await dialog.locator("#start-title", { hasText: "Build the deck" }).waitFor();
  // The popup shows what the card delivers under its title, with no field
  // labels.
  assert.equal(
    await dialog.locator("#start-delivers").textContent(),
    "Build the deck, delivered.",
  );
  assert.doesNotMatch(await dialog.textContent(), /Delivers|May change/);
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
  // The card quotes the message, so it shows all the reviewer approved.
  assert.equal(
    await page
      .locator("[data-proposal-card=deck] .proposal-message")
      .textContent(),
    "“Keep the header height.”",
  );
  // The reader stays on Work.
  assert.equal(new URL(page.url()).hash, "#work");
});

// Only Send feedback answers a round. With round 1 waiting and a note
// drafted on it, the reviewer starts two cards here: the round still waits,
// the agent reads each Start, and the note is still a draft on Review.
test("Start here leaves the waiting round open with its drafts, so a second card can start", async (t) => {
  const { session, page, tab } = await work(t);
  if (!page) return;
  await page.locator('#page-list [data-page="overview"]').click();
  await page.locator("#comment-here").click();
  await page.locator("#note-text").fill("Keep the header height.");
  await page.getByRole("button", { name: "Add to feedback" }).click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await page.locator("#work-row").click();
  const dialog = page.locator("#start-dialog");
  for (const id of ["deck", "export"]) {
    await tab("proposed").click();
    await page.locator(`[data-proposal-card=${id}] .proposal-start`).click();
    await dialog.locator("#start-send").click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal((await session.status()).body.needsYou, true);
    const read = (await session.action("read")).body;
    assert.equal(read.moment, "read-start-here");
    assert.equal(read.event.payload.proposal, id);
    assert.equal((await session.status()).body.needsYou, true);
  }
  // Both cards run here, and neither needs the reviewer while the round
  // waits.
  await tab("running").locator(".work-count", { hasText: "2" }).waitFor();
  assert.equal(await tab("needs").locator(".work-count").textContent(), "0");
  await tab("running").click();
  for (const id of ["deck", "export"])
    assert.equal(
      await page.locator(`[data-proposal-card=${id}] .card-meta`).textContent(),
      "Working here",
    );
  await page.locator("#review-row").click();
  await page
    .locator("#feedback-groups", { hasText: "Keep the header height." })
    .waitFor();
  assert.equal(await page.locator("#submit").isEnabled(), true);
  // A card names no round, done or not.
  const done = await session.action("propose", { id: "deck", done: true });
  assert.equal(done.code, 200, done.body.error);
  await page.locator("#work-row").click();
  await tab("done").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("done").click();
  assert.doesNotMatch(
    await page.locator("[data-proposal-card=deck] .card-meta").textContent(),
    /round/i,
  );
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

// The agent starts a card when the reviewer asks for the work in their own
// words. The card quotes them, links to where they wrote them, and has no
// button that stops the work.
test("a card started on the reviewer's words quotes them and links to where they wrote them", async (t) => {
  const { session, page, tab } = await work(t);
  if (!page) return;
  await tab("proposed").locator(".work-count", { hasText: "2" }).waitFor();
  const started = await session.action("propose", {
    id: "deck",
    start: "here",
    quote: "Build the deck now.\nKeep the header height.",
    page: "1/overview",
  });
  assert.equal(started.code, 200, started.body.error);
  await tab("running").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("running").click();
  const card = page.locator("[data-proposal-card=deck]");
  await card.waitFor();
  assert.equal(await card.locator(".card-meta").textContent(), "Working here");
  const lead = card.locator(".proposal-lead");
  assert.equal(
    await lead.textContent(),
    "Started from your words on the Overview page",
  );
  assert.equal(await lead.locator("a").getAttribute("href"), "#overview");
  assert.equal(
    await card.locator(".proposal-message").innerText(),
    "“Build the deck now.\nKeep the header height.”",
  );
  assert.deepEqual(
    await card.locator(".proposal-foot button").allTextContents(),
    ["Comment"],
  );
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
  // The needs-you pill ends the row, after the proposed number.
  const edges = await page.locator("#work-row").evaluate((row) => {
    const box = (kind) =>
      row.querySelector(`.count.${kind}`).getBoundingClientRect();
    return {
      rowEnd:
        row.getBoundingClientRect().right -
        parseFloat(getComputedStyle(row).paddingRight),
      needs: box("needs"),
      proposed: box("proposed"),
    };
  });
  assert.ok(
    edges.proposed.right < edges.needs.left,
    `the proposed number ends at ${edges.proposed.right}, the pill starts at ${edges.needs.left}`,
  );
  assert.equal(Math.round(edges.needs.right), Math.round(edges.rowEnd));
});
