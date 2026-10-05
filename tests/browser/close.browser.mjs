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

// On a phone, a closed session's line under the header stays one line:
// only the session's long title is cut short, and "is closed" stays whole.
test("a closed session's line under the header stays one line on a phone", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const title =
    "Merge the ten 0.3 pull requests into develop in order and release 0.3 to npm";
  assert.equal((await session.publish({ ...planData(), title })).code, 200);
  assert.equal(
    (await session.request(`${session.base}/api/dismiss`, {})).code,
    200,
  );
  const page = await open(t, `${h.server.origin}${session.base}/`, {
    viewport: { width: 390, height: 844 },
  });
  if (!page) return;
  await page.locator("#history-strip:not([hidden])").waitFor();
  const line = await page.locator("#history-label").evaluate((label) => ({
    height: label.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(label).lineHeight),
    cut: [...label.children]
      .filter((part) => part.scrollWidth > part.clientWidth)
      .map((part) => part.textContent),
  }));
  assert.ok(line.height < line.lineHeight * 1.5, JSON.stringify(line));
  assert.deepEqual(line.cut, [title]);
});
