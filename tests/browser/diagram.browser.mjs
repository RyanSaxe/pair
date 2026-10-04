import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubMermaid } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

test("a diagram never makes the browser window scroll while it renders", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const data = {
    ...planData("1"),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: "<div data-diagram>flowchart LR\n  A --> B</div>",
      },
    ],
  };
  assert.equal((await session.publish(data)).code, 200);
  const page = await open(t, "about:blank", {
    viewport: { width: 1100, height: 700 },
  });
  if (!page) return;
  await stubMermaid(page);
  // The tallest the document gets on any frame until the diagram draws.
  await page.addInitScript(() => {
    window.tallest = 0;
    const sample = () => {
      window.tallest = Math.max(
        window.tallest,
        document.documentElement.scrollHeight,
      );
      if (!document.querySelector("[data-diagram] svg"))
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(`${h.server.origin}${session.base}/#overview`);
  await page.locator("[data-diagram] svg").waitFor();
  const tallest = await page.evaluate(() => window.tallest);
  assert.ok(tallest <= 700, `the document reached ${tallest}px`);
});
