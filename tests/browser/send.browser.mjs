import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

// Each choice in the Send popup: its value, its label and whether it is
// selected.
const choices = (page) =>
  page
    .locator("#send-choices [data-next]")
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.dataset.next,
        row.querySelector(".start-choice").textContent,
        row.getAttribute("aria-checked"),
      ]),
    );
async function openPopup(page) {
  await page.locator("#submit").click();
  await page.locator("#send-dialog[open]").waitFor();
}
// The submission the agent reads once the hub has saved one.
async function sent(session) {
  assert.equal(
    await waitUntil(
      async () => (await session.status()).body.latestSubmissionId,
    ),
    true,
  );
  return (await session.action("read")).body.event.payload;
}

test("Send feedback opens a popup that starts on Keep iterating and sends the choice and the message", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#feedback`);
  if (!page) return;
  await openPopup(page);
  assert.deepEqual(await choices(page), [
    ["iterate", "Keep iterating", "true"],
    ["plan", "Write a plan", "false"],
    ["build", "Build it", "false"],
  ]);
  const button = page.locator("#send-button");
  assert.equal(await page.locator("#send-label").textContent(), "Send");
  // With no comments, the switch off and no message, the first choice
  // sends nothing, and any other choice does.
  await page.locator("#align-unflagged").click();
  assert.equal(await button.isDisabled(), true);
  await page.locator('#send-choices [data-next="build"]').click();
  assert.equal(await button.isEnabled(), true);
  assert.equal(await page.locator("#send-label").textContent(), "Build it");
  // The arrow keys move between the choices.
  await page.keyboard.press("ArrowUp");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.next),
    "plan",
  );
  assert.equal(await page.locator("#send-label").textContent(), "Send");
  await page.locator("#send-message").fill("Show the plan in two pages.");
  await page.locator("#send-message").press("Shift+Enter");
  await page.locator("#send-dialog").waitFor({ state: "hidden" });
  const payload = await sent(session);
  assert.equal(payload.next, "plan");
  assert.equal(payload.message, "Show the plan in two pages.");
  assert.equal(payload.groups.alignUnflagged, false);
});

test("a plan round has the Plan tag and its own choices, and Review lists the choice sent", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/`);
  if (!page) return;
  await page.locator("#page-title", { hasText: "Agreed so far" }).waitFor();
  assert.equal(await page.locator("#page-title .tag").count(), 0);
  await openPopup(page);
  await page.locator('#send-choices [data-next="plan"]').click();
  await page.locator("#send-message").fill("Plan the retry.");
  await page.locator("#send-button").click();
  assert.equal((await sent(session)).next, "plan");
  // The plan round reaches the open tab, whose Agreed and Rounds panel
  // mark it.
  assert.equal(
    (await session.publish({ ...planData("2"), plan: true })).code,
    200,
  );
  await page.locator("#page-title .tag.plan", { hasText: "Plan" }).waitFor();
  await page.locator("#round").click();
  const rows = page.locator("#round-list .sess-row");
  await rows.nth(1).waitFor();
  assert.deepEqual(
    await rows.evaluateAll((list) =>
      list.map((row) => [
        row.querySelector(".t").firstChild.textContent,
        row.querySelector(".tag")?.textContent ?? null,
      ]),
    ),
    [
      ["Round 2", "Plan"],
      ["Round 1", null],
    ],
  );
  await page.keyboard.press("Escape");
  await openPopup(page);
  assert.deepEqual(await choices(page), [
    ["plan", "Update the plan", "true"],
    ["iterate", "Back to iterating", "false"],
    ["build", "Build it", "false"],
  ]);
  await page.keyboard.press("Escape");
  // Round 1's Feedback lists the choice and the message with what was sent.
  await page.goto(`${h.server.origin}${session.base}/r/1#feedback`);
  const list = page.locator("#sent-feedback-list");
  await list.locator(".sent-card").first().waitFor();
  assert.deepEqual(
    await list
      .locator(".sent-card")
      .evaluateAll((cards) =>
        cards
          .slice(0, 2)
          .map((card) => [
            card.querySelector("small").textContent,
            card.querySelector("p").textContent,
          ]),
      ),
    [
      ["What comes next", "Write a plan"],
      ["Message to the agent", "Plan the retry."],
    ],
  );
});

// Plan it first has the card's own session plan before it builds, so it is
// off with Here, and the card reads Planning until that session's reviewer
// chooses Build it.
test("Plan it first is off with Here, and its card reads Planning until its session chooses Build it", async (t) => {
  const h = await hub(t);
  const parent = await h.session({ start: true });
  assert.equal((await parent.publish(planData())).code, 200);
  const added = await parent.action("propose", {
    id: "deck",
    title: "Build the deck",
    delivers: "Build the deck, delivered.",
    recommend: "sub-session",
  });
  assert.equal(added.code, 200, added.body.error);
  const page = await open(t, `${h.server.origin}${parent.base}/#work`);
  if (!page) return;
  await page.locator("[data-proposal-card=deck] .proposal-start").click();
  const dialog = page.locator("#start-dialog");
  const box = dialog.locator("#start-plan-first");
  await dialog.locator("#start-title", { hasText: "Build the deck" }).waitFor();
  assert.equal(await box.isChecked(), false);
  await box.check();
  await dialog.locator("[data-where=here]").click();
  assert.deepEqual(
    [await box.isChecked(), await box.isDisabled()],
    [false, true],
  );
  await dialog.locator("[data-where=sub-session]").click();
  await box.check();
  await dialog.locator("#start-send").click();
  await dialog.waitFor({ state: "hidden" });
  const started = (await parent.status()).body.proposals[0].started;
  assert.deepEqual([started.where, started.planFirst], ["sub-session", true]);
  const child = await h.session({
    start: true,
    from: parent.directory,
    proposal: "deck",
  });
  const state = page.locator("[data-proposal-card=deck] .card-state");
  await page.locator("#work-tab-running").click();
  await state.filter({ hasText: "Planning in a sub-session" }).waitFor();
  // The sub-session's plan round waits for the reviewer, which the card
  // says instead.
  assert.equal((await child.publish({ ...planData(), plan: true })).code, 200);
  await page.locator("#work-tab-needs").click();
  await state.filter({ hasText: "Waiting for you" }).waitFor();
  const built = await child.feedback(
    child.event("feedback-only", "1", { next: "build" }),
  );
  assert.equal(built.code, 200, built.body.error);
  await page.locator("#work-tab-running").click();
  await state.filter({ hasText: "Working" }).waitFor();
});
