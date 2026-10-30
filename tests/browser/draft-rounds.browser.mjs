import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

const poll = { timeout: 8000 };

const checklist = `<p>Retry the failures below.</p>
<div class="scope-list" data-multiselect="retryable" data-label="Which failures are retried">
  <label class="scope-row"><span><strong>5xx responses</strong></span><input type="checkbox" class="scope-check" data-value="5xx" data-label="5xx responses" /></label>
  <label class="scope-row"><span><strong>Timeouts</strong></span><input type="checkbox" class="scope-check" data-value="timeouts" data-label="Timeouts" /></label>
  <label class="scope-row"><span><strong>TLS errors</strong></span><input type="checkbox" class="scope-check" data-value="tls" data-label="TLS errors" /></label>
</div>`;
const round = (number) => {
  const data = planData(number);
  data.pages[0].html = checklist;
  return data;
};
const box = (page, value) =>
  page.locator(`[data-multiselect="retryable"] input[data-value="${value}"]`);
const nothingToSend = (page) =>
  page.locator("#draft-head[hidden]").waitFor({ ...poll, state: "attached" });
const onRound = (page, number) =>
  page
    .locator(`#round[aria-label="Rounds, on round ${number}"]`)
    .waitFor({ ...poll, state: "attached" });

const ticked = (page, value, checked = true) =>
  page
    .locator(
      `[data-multiselect="retryable"] input[data-value="${value}"]${checked ? ":checked" : ":not(:checked)"}`,
    )
    .waitFor(poll);

// The phone ticks the checklist, the computer changes it, and the phone sends.
// develop starts the next round with no box ticked, and so must both
// browsers, also after the frame rebuilds the checklist from the new round's
// page.
test("a checklist sent from one browser starts unticked in the next round on both", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(round("1"))).code, 200);
  const url = `${h.server.origin}${session.base}/#overview`;
  const computer = await open(t, url);
  if (!computer) return;
  const phone = await open(t, url, { viewport: { width: 375, height: 812 } });

  await box(phone, "5xx").check();
  await box(phone, "timeouts").check();
  await ticked(computer, "timeouts");
  await box(computer, "timeouts").uncheck();
  await ticked(phone, "timeouts", false);
  await phone.locator("#submit").click();
  await phone.locator("#send-button").click();
  await nothingToSend(computer);
  await session.action("read");
  assert.equal((await session.publish(round("2"))).code, 200);
  for (const page of [phone, computer]) {
    await page.goto("about:blank");
    await page.goto(url);
    await onRound(page, "2");
    // Each browser has merged the hub's draft and sent its own changes by
    // the second status poll.
    await page.waitForTimeout(3500);
    await nothingToSend(page);
    assert.equal(await box(page, "5xx").isChecked(), false);
  }
});

test("Everything else looks good is on again in the next round after a send, on both browsers", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(round("1"))).code, 200);
  const url = `${h.server.origin}${session.base}/#overview`;
  const computer = await open(t, url);
  if (!computer) return;
  const phone = await open(t, url, { viewport: { width: 375, height: 812 } });

  await box(phone, "5xx").check();
  await phone.locator("#submit").click();
  await phone.locator("#align-unflagged").uncheck();
  // The tick and the switch reach the hub in one change, so the computer has
  // merged the switch once it shows the tick.
  await ticked(computer, "5xx");
  await phone.locator("#send-button").click();
  await nothingToSend(computer);
  await session.action("read");
  assert.equal((await session.publish(round("2"))).code, 200);
  for (const page of [phone, computer]) {
    await page.goto("about:blank");
    await page.goto(url);
    await onRound(page, "2");
    // Each browser has merged the hub's draft by the second status poll.
    await page.waitForTimeout(3500);
    await page.locator("#submit").click();
    await page.locator("#send-dialog[open]").waitFor(poll);
    assert.equal(await page.locator("#align-unflagged").isChecked(), true);
  }
});
