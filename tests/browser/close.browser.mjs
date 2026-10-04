import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

test("Close on this tab's own row asks first, then the tab turns read-only and names the session", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const closes = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/dismiss")) closes.push(request.url());
  });
  const close = page.locator(`[data-key="close:${session.id}"]:visible`);
  await page.locator("#menu-button").click();
  await close.click();
  const dialog = page.locator("#close-dialog");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await dialog.evaluate((element) => element.open), false);
  assert.deepEqual(closes, []);
  assert.notEqual((await session.status()).body.stage, "complete");

  await page.locator("#menu-button").click();
  await close.click();
  const reload = page.waitForEvent("load");
  await page.locator("#close-confirm").click();
  await reload;
  assert.equal(closes.length, 1);
  assert.equal((await session.status()).body.stage, "complete");
  await page.locator("#history-strip:not([hidden])").waitFor();
  assert.equal(
    await page.locator("#history-label").textContent(),
    "Example work is closed",
  );
});
