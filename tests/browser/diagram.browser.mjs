import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// Stands in for Mermaid from jsDelivr, so the test runs offline. Like
// Mermaid, render() draws a full-size element to measure the diagram, in
// the container it is given or else at the end of the body, and removes it
// when the render ends.
const mermaid = `export default {
  initialize() {},
  registerLayoutLoaders() {},
  async render(id, source, container = document.body) {
    const drawing = document.createElement("div");
    drawing.id = "d" + id;
    drawing.style.height = "3000px";
    container.append(drawing);
    await new Promise((resolve) => setTimeout(resolve, 300));
    drawing.remove();
    return { svg: '<svg viewBox="0 0 120 40"></svg>' };
  },
};`;

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
  await page.route(/mermaid\.esm\.min\.mjs$|mermaid-layout-elk/, (route) =>
    route.fulfill({ body: mermaid, contentType: "text/javascript" }),
  );
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
