import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep } from "../support/hub.mjs";

// The browser runs the rendering steps, and with them the first animation
// frame's callbacks, only once nothing blocks rendering, and paints right
// after them. A callback registered before any of the page's scripts run
// sees what the first paint shows.
function recordFirstFrame() {
  requestAnimationFrame(() => {
    const shown = (id) => {
      const element = document.getElementById(id);
      return element && { text: element.innerText, hidden: element.hidden };
    };
    window.firstFrame = JSON.stringify({
      header: shown("frame-header"),
      submit: document.getElementById("submit")?.disabled,
      sessions: shown("sessions-count"),
      bell: shown("bell-count"),
      pages: shown("navigation"),
      title: shown("page-title"),
      content: shown("page-content"),
    });
  });
}

test("a session opened from the sessions menu paints its first frame fully drawn", async (t) => {
  const h = await hub(t);
  const first = await h.session();
  assert.equal(
    (await first.publish({ ...planData(), title: "First" })).code,
    200,
  );
  const second = await h.session();
  assert.equal(
    (await second.publish({ ...planData(), title: "Second" })).code,
    200,
  );
  const page = await open(t, `${h.server.origin}${first.base}/`);
  if (!page) return;
  await page.addInitScript(recordFirstFrame);
  // Whether Chrome paints between the page's scripts depends on timing, so
  // the test switches several times.
  for (const title of ["Second", "First", "Second", "First"]) {
    await page.locator("#menu-button").click();
    await Promise.all([
      page.waitForURL((url) =>
        url.href.includes(title === "First" ? first.base : second.base),
      ),
      page.locator("#sessions-list .sess-row", { hasText: title }).click(),
    ]);
    await page.waitForFunction(() => window.firstFrame);
    // The frame's first poll answers from the page, so the page drawn after
    // the frame settles is the page of the first frame.
    await sleep(500);
    const firstFrame = JSON.parse(await page.evaluate(() => window.firstFrame));
    await page.evaluate(() => (window.firstFrame = null));
    await page.evaluate(recordFirstFrame);
    await page.waitForFunction(() => window.firstFrame);
    const settled = JSON.parse(await page.evaluate(() => window.firstFrame));
    assert.ok(firstFrame.content.text.trim(), `${title}: an empty page`);
    assert.deepEqual(firstFrame, settled, title);
  }
});
