import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

// This test checks the frame's handling of links in a stand-in SVG. The figure
// suite in figures.mjs checks parsing and layout with the real library.
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

// The browser must not run a Pele whose bytes differ from its pinned hash, even
// one that draws correctly.
test("a diagram whose library fails to load or does not match its hash preserves its source and leaves the page readable", async (t) => {
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
  const failures = [
    (route) => route.abort(),
    (route) =>
      route.fulfill({
        body: "window.tampered = true; export function mount() {}",
        contentType: "text/javascript",
      }),
  ];
  for (const failure of failures) {
    // Playwright tries the most recently added route first.
    await page.route(/pele@[^/]+\/dist\/pele\.js$/, failure);
    await page.goto(`${h.server.origin}${session.base}/#overview`);
    await page.locator(".renderer-error:visible").waitFor();
    assert.equal(await page.locator("#readable").isVisible(), true);
    assert.match(await page.locator("[data-diagram]").innerText(), /A --> B/);
    assert.equal(await page.locator("body > svg").count(), 0);
    assert.equal(await page.evaluate(() => window.tampered), undefined);
  }
});

// boxNotePage opens a diagram page for the tests that note one box, by a click
// on the box in the full-size dialog or by a drag across its label on the page.
async function boxNotePage(t) {
  const h = await hub(t);
  const session = await h.session();
  const data = {
    ...planData(),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: "<h2>Flow</h2><div data-diagram>flowchart LR\n  gate --> details</div>",
      },
      { id: "details", title: "Details", html: "<p>Details.</p>" },
    ],
  };
  assert.equal((await session.publish(data)).code, 200);
  const page = await open(t, "about:blank");
  if (!page) return null;
  await stubPele(page);
  await page.goto(`${h.server.origin}${session.base}/#overview`);
  await page.locator("[data-diagram] svg").waitFor();
  return page;
}
const noteDialog = async (page) => {
  await page.locator("#note-dialog[open]").waitFor();
  return {
    anchor: await page.locator("#note-anchor").textContent(),
    quote: await page.locator("#note-quote").textContent(),
  };
};
const boxFill = (page, id) =>
  page
    .locator(`[data-diagram] .pele-node[data-id="${id}"] > rect`)
    .evaluate((rect) => getComputedStyle(rect).fill);
const markColor = (page) =>
  page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = "var(--mark)";
    document.body.append(probe);
    return getComputedStyle(probe).color;
  });
async function addNote(page, text) {
  await page.locator("#note-text").fill(text);
  await page.getByRole("button", { name: "Add to feedback" }).click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
}

test("a click on a box in the full-size dialog opens a note quoting its label, and the noted box on the page takes the note color and opens the note", async (t) => {
  const page = await boxNotePage(t);
  if (!page) return;
  assert.notEqual(await boxFill(page, "gate"), await markColor(page));
  await page.locator("[data-diagram] svg").click({ position: { x: 2, y: 2 } });
  await page.locator("#diagram-dialog .pele-node[data-id=gate] text").click();
  assert.equal(
    await page.locator("#diagram-dialog").evaluate((el) => el.open),
    false,
  );
  assert.deepEqual(await noteDialog(page), {
    anchor: "Overview › Flow",
    quote: "Payment gateway",
  });
  await addNote(page, "Retry here?");
  await waitUntil(
    async () => (await boxFill(page, "gate")) === (await markColor(page)),
  );
  assert.notEqual(await boxFill(page, "details"), await markColor(page));
  await page.locator("[data-diagram] .pele-node[data-id=gate] text").click();
  assert.deepEqual(await noteDialog(page), {
    anchor: "Overview › Flow",
    quote: "Payment gateway",
  });
  assert.equal(await page.locator("#note-text").inputValue(), "Retry here?");
  assert.equal(
    await page.locator("#diagram-dialog").evaluate((el) => el.open),
    false,
  );
});

test("a drag across a box's label on the page selects it for a note on the box instead of opening the full-size dialog", async (t) => {
  const page = await boxNotePage(t);
  if (!page) return;
  const label = await page
    .locator("[data-diagram] .pele-node[data-id=gate] text")
    .boundingBox();
  await page.mouse.move(label.x + 1, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + label.width - 1, label.y + label.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Comment on selection", exact: true })
    .click();
  assert.equal(
    await page.locator("#diagram-dialog").evaluate((el) => el.open),
    false,
  );
  assert.deepEqual(await noteDialog(page), {
    anchor: "Overview › Flow",
    quote: "Payment gateway",
  });
  await addNote(page, "Retry here?");
  await waitUntil(
    async () => (await boxFill(page, "gate")) === (await markColor(page)),
  );
});
