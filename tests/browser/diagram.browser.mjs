import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

test("a diagram never makes the browser window scroll while rendering", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const edges = Array.from(
    { length: 32 },
    (_, index) =>
      `  N${index}["Step ${index}"] --> N${index + 1}["Step ${index + 1}"]`,
  ).join("\n");
  const data = {
    ...planData("1", undefined, "diagram"),
    pages: [
      { id: "overview", title: "Overview", html: "<p>Start here.</p>" },
      {
        id: "details",
        title: "Details",
        html: `<div data-diagram>flowchart TB\n${edges}</div>`,
      },
    ],
  };
  assert.equal((await session.publish(data)).code, 200);

  const page = await open(t, "about:blank", {
    viewport: { width: 1100, height: 700 },
  });
  if (!page) return;

  await page.addInitScript(() => {
    window.__documentHeight = { max: 0, viewport: innerHeight };
    const sample = () => {
      window.__documentHeight.max = Math.max(
        window.__documentHeight.max,
        document.documentElement.scrollHeight,
      );
      if (!document.querySelector("#page-content [data-diagram] svg"))
        requestAnimationFrame(sample);
    };
    new MutationObserver(sample).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    requestAnimationFrame(sample);
  });
  await page.goto(`${h.server.origin}${session.base}/`);
  await page.locator('#page-list [data-page="details"]').click();
  await page.locator("#page-content [data-diagram] svg").first().waitFor({
    timeout: 30000,
  });
  const height = await page.evaluate(() => window.__documentHeight);
  assert.ok(
    height.max <= height.viewport,
    `the document reached ${height.max}px in a ${height.viewport}px window`,
  );
});
