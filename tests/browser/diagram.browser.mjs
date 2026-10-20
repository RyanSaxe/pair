import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// These interactions belong to the frame. The fixed SVG fixture leaves
// parsing and layout to the real-library figure suite.
test("diagram page links work by pointer and keyboard on the page and in the full-size dialog, while URL links keep their destination", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const data = {
    ...planData(),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: "<div data-diagram>flowchart LR\n  details --> native</div>",
      },
      {
        id: "details",
        title: "Details",
        html: "<p id=destination>Page link destination</p>",
      },
      {
        id: "native",
        title: "Native",
        html: "<p>Page with the same ID as a URL-linked node.</p>",
      },
    ],
  };
  assert.equal((await session.publish(data)).code, 200);
  const page = await open(t, "about:blank");
  if (!page) return;
  await stubPele(page);
  await page.route("https://example.test/native", (route) =>
    route.fulfill({ body: "Native URL destination", contentType: "text/html" }),
  );
  const overview = `${h.server.origin}${session.base}/#overview`;
  for (const fullSize of [false, true]) {
    for (const key of [null, "Enter", "Space"]) {
      await page.goto(overview);
      await page.locator("[data-diagram] svg").waitFor();
      if (fullSize)
        await page
          .locator("[data-diagram] svg")
          .click({ position: { x: 2, y: 2 } });
      const scope = fullSize ? "#diagram-dialog" : "[data-diagram]";
      const link = page
        .getByRole("link", { name: "Open Details", exact: true })
        .and(page.locator(`${scope} [data-id=details]`));
      if (key) {
        await link.focus();
        await link.press(key);
      } else await link.click();
      await page.locator("#destination").waitFor();
      assert.equal(new URL(page.url()).hash, "#details");
      assert.equal(
        await page.locator("#diagram-dialog").evaluate((el) => el.open),
        false,
      );
    }
    await page.goto(overview);
    await page.locator("[data-diagram] svg").waitFor();
    if (fullSize)
      await page
        .locator("[data-diagram] svg")
        .click({ position: { x: 2, y: 2 } });
    const scope = fullSize ? "#diagram-dialog" : "[data-diagram]";
    await page
      .locator(`${scope} a[href="https://example.test/native"]`)
      .click();
    await page.waitForURL("https://example.test/native");
    assert.match(
      await page.locator("body").innerText(),
      /Native URL destination/,
    );
  }
});

test("a diagram load failure preserves its source and leaves the page readable", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const source = "flowchart LR\n  A --> B";
  const data = {
    ...planData(),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: `<p id=readable>Read this even when a diagram fails.</p><div data-diagram>${source}</div>`,
      },
    ],
  };
  assert.equal((await session.publish(data)).code, 200);
  const page = await open(t, "about:blank");
  if (!page) return;
  await page.route(/pele@[^/]+\/dist\/pele\.js$/, (route) => route.abort());
  await page.goto(`${h.server.origin}${session.base}/#overview`);
  await page.locator(".renderer-error:visible").waitFor();
  assert.equal(await page.locator("#readable").isVisible(), true);
  assert.match(await page.locator("[data-diagram]").innerText(), /A --> B/);
  assert.equal(await page.locator("body > svg").count(), 0);
});
