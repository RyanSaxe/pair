import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

// Each review starts on the Overview page, so the heading of the page on
// screen reads differently from Agreed's.
const onScreen = { id: "page-title", text: "Overview" };
const agreed = { id: "page-title", text: "Agreed so far" };
const banner = { id: "accepted" };
const reviews = [
  { offer: "finish", action: "Finish without a PR", focus: [onScreen] },
  { offer: "finish", action: "Open a PR", focus: [onScreen] },
  { offer: "plan", action: "Save for later", focus: [banner] },
  // The frame polls the hub every 1.5 s, and the first poll after the
  // acceptance shows Agreed.
  { offer: "plan", action: "Start implementation", focus: [onScreen, agreed] },
  { offer: "plan", action: "Request changes", focus: [agreed] },
  { offer: "finish", action: "Request changes", focus: [agreed] },
];

async function openFinish(t, offer) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData("1", offer))).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`, {});
  if (!page) return null;
  await page.locator("#submit:enabled").waitFor();
  await page.keyboard.press("s");
  await page.keyboard.press("Enter");
  await page.locator("#finish-dialog[open]").waitFor();
  return { session, page };
}

// Chooses the review's decision and returns the button that sends it. The
// button is pressed with the keyboard, because a click focuses a button in
// Chrome but not in Safari on macOS.
async function decide(page, action) {
  if (action === "Request changes") {
    await page.locator('[data-decision="accept"]').focus();
    await page.keyboard.press("ArrowDown");
    await page
      .locator('[data-decision="changes"][aria-checked="true"]')
      .waitFor();
    await page.locator("#request-comment").fill("Keep the current behavior.");
    return page.locator("#request-changes");
  }
  return page.locator("#accept-actions").getByRole("button", { name: action });
}

// Records each element that takes focus, with its text at that moment,
// because the poll after Start implementation can replace the page on
// screen before a check of the focused element runs.
const recordFocus = (page) =>
  page.evaluate(() => {
    window.focusTrail = [];
    document.addEventListener("focusin", ({ target }) =>
      window.focusTrail.push({ id: target.id, text: target.textContent }),
    );
  });
const focusedOnce = (page, target) =>
  page.waitForFunction(
    ({ id, text }) =>
      window.focusTrail.some(
        (entry) =>
          entry.id === id && (text === undefined || entry.text === text),
      ),
    target,
    { timeout: 5000 },
  );
const focusedNow = (page, { id, text }, timeout) =>
  page.waitForFunction(
    ({ id, text }) =>
      document.activeElement?.id === id &&
      document.activeElement.textContent === text,
    { id, text },
    { timeout },
  );

for (const { offer, action, focus } of reviews) {
  const name = `Finish your review on a ${offer} round, ${action}`;

  test(`${name}, sends once and keeps focus on the page`, async (t) => {
    const opened = await openFinish(t, offer);
    if (!opened) return;
    const { page, session } = opened;
    const button = await decide(page, action);
    await button.focus();
    await recordFocus(page);
    await page.keyboard.press("Enter");

    await focusedOnce(page, focus[0]);
    if (focus[1]) await focusedNow(page, focus[1], 3000);
    assert.ok(await waitUntil(() => session.inbox.wakes.length === 1));
    assert.equal(await page.locator("#finish-dialog").isVisible(), false);
    assert.equal(session.inbox.wakes.length, 1);
  });

  test(`${name}, keeps the dialog open when the hub refuses`, async (t) => {
    const opened = await openFinish(t, offer);
    if (!opened) return;
    const { page } = opened;
    await page.route("**/api/feedback", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Refused for the check." }),
      }),
    );
    const button = await decide(page, action);
    await button.focus();
    await page.keyboard.press("Enter");

    await page
      .locator("#finish-error", { hasText: "Refused for the check." })
      .waitFor();
    assert.equal(await page.locator("#finish-dialog").isVisible(), true);
    assert.equal(
      await button.evaluate((element) => element === document.activeElement),
      true,
    );
  });
}
