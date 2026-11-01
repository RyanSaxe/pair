import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const pages = [
  {
    id: "overview",
    title: "Overview",
    html: `
<h2>Failure handling</h2>
<p>Retries use exponential backoff.</p>
<section class="visual-decision" data-choice="place" data-label="Place">
  <h3>Where should it go?</h3>
  <article class="visual-option" data-value="left" data-label="Left"><p>Beside the capybara.</p></article>
  <article class="visual-option" data-value="right" data-label="Right"><p>Beside the narwhal.</p></article>
</section>
<details><summary>More</summary><p>A folded mention of the pangolin.</p></details>
<figure><img alt="A drawing of a wombat" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="1" height="1" /></figure>`,
  },
  {
    id: "second",
    title: "Second page",
    html: "<p>A sentence about the walrus.</p><p>Another about the lemur.</p>",
  },
];

async function searchPage(t, options = {}) {
  const h = await hub(t);
  const a = await h.session();
  const published = await a.publish({ ...planData(), pages });
  assert.equal(published.code, 200, published.body.error);
  const page = await open(t, "about:blank", options);
  if (!page) return {};
  await stubPele(page);
  await page.goto(`${h.server.origin}${a.base}/#overview`);
  await page.locator("#search-button").waitFor();
  await waitUntil(
    async () =>
      !(await (await fetch(`${h.server.origin}/api/search?q=x`)).json())
        .loading,
  );
  return { h, a, page };
}

const type = async (page, query) => {
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("q") === query,
  );
  await page.fill(".search-input", query);
  await answered;
  await page.evaluate(() => new Promise(requestAnimationFrame));
};
const selected = (page) =>
  page.locator('.search-row[aria-selected="true"] .search-title');

test("the icon opens search, and typing filters the list as it goes", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await page.locator("#search-dialog[open]").waitFor();
  assert.ok(await page.locator(".search-row").count());
  await type(page, "walrus");
  assert.equal(await page.locator(".search-row").count(), 1);
  assert.equal(await page.locator(".search-count").textContent(), "1 result");
  assert.match(
    await page.locator(".search-snippet mark").first().textContent(),
    /walrus/,
  );
  await type(page, "exponentail");
  assert.match(await selected(page).textContent(), /Failure handling/);
});

test("the keys open and close search and move through it", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press("/");
  await page.locator("#search-dialog[open]").waitFor();
  await type(page, "walrus lemur");
  await page.keyboard.press("Escape");
  await page
    .locator("#search-dialog:not([open])")
    .waitFor({ state: "attached" });
  // Reopening keeps the words, selected so typing replaces them.
  await page.keyboard.press(`${modifier}+k`);
  await page.locator("#search-dialog[open]").waitFor();
  assert.equal(await page.inputValue(".search-input"), "walrus lemur");
  assert.deepEqual(
    await page.evaluate(() => {
      const { selectionStart, selectionEnd } = document.activeElement;
      return [selectionStart, selectionEnd];
    }),
    [0, "walrus lemur".length],
  );
  await type(page, "about");
  assert.equal(await selected(page).count(), 1);
  await page.keyboard.press("ArrowDown");
  assert.notEqual(
    await page
      .locator('.search-row[aria-selected="true"]')
      .getAttribute("data-i"),
    "0",
  );
  await page.keyboard.press("Tab");
  await page.waitForFunction(
    () =>
      document.querySelector(".search-kinds-button").textContent === "Pages",
  );
  await page.keyboard.press("Alt+KeyS");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-toggle="allSessions"]').textContent ===
      "All sessions",
  );
  await page.keyboard.press("Alt+KeyR");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-toggle="allRounds"]').textContent ===
      "Latest round",
  );
  await page.keyboard.press(`${modifier}+k`);
  await page
    .locator("#search-dialog:not([open])")
    .waitFor({ state: "attached" });
});

test("a slash in a note types a slash, and the modifier key still opens search", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press("c");
  await page.locator("#note-text").waitFor();
  await page.keyboard.press("/");
  assert.equal(await page.inputValue("#note-text"), "/");
  assert.equal(await page.locator("#search-dialog[open]").count(), 0);
  await page.keyboard.press(`${modifier}+k`);
  await page.locator("#search-dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.inputValue("#note-text"), "/");
});

test("the filters narrow the list, and the kinds menu toggles each kind", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await type(page, "about");
  const button = page.locator(".search-kinds-button");
  assert.equal(await button.textContent(), "All kinds");
  await button.click();
  await page.locator('.search-kind[data-kind="threads"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector(".search-kinds-button").textContent === "Threads",
  );
  await page.locator(".search-blank").waitFor();
  await page.locator('.search-kind[data-kind="pages"]').click();
  await page.locator(".search-row").first().waitFor();
  assert.equal(await button.textContent(), "Pages, Threads");
  await page.locator('.search-kind[data-kind=""]').click();
  await page.waitForFunction(
    () =>
      document.querySelector(".search-kinds-button").textContent ===
      "All kinds",
  );
  // Esc closes the menu first, and then the modal.
  assert.equal(await page.locator(".search-kinds").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".search-kinds").isVisible(), false);
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
});

test("a search that finds nothing offers one filter to loosen, and keeps the words", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await page.locator(".search-kinds-button").click();
  await page.locator('.search-kind[data-kind="threads"]').click();
  await page.locator(".search-kinds-button").click();
  await type(page, "walrus");
  await page.locator("[data-wider]").click();
  await page.locator(".search-row").first().waitFor();
  assert.equal(await page.inputValue(".search-input"), "walrus");
  assert.equal(
    await page.locator(".search-kinds-button").textContent(),
    "All kinds",
  );
});

test("an answer to an older search never replaces a newer one", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await page.locator(".search-row").first().waitFor();
  await page.route(/\/api\/search\?q=walrus&/, async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.continue().catch(() => {});
  });
  await page.fill(".search-input", "walrus");
  await type(page, "lemur");
  await page.waitForTimeout(600);
  assert.match(
    await page.locator(".search-snippet").first().textContent(),
    /lemur/,
  );
});

test("the preview shows the selected row's words, with its place and Open above them", async (t) => {
  const { a, page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await type(page, "walrus");
  const pane = page.locator(".search-preview");
  assert.equal(await pane.locator(".search-text mark").textContent(), "walrus");
  assert.match(
    await pane.locator(".search-crumbs").textContent(),
    /Second page/,
  );
  assert.match(
    await pane.locator(".search-preview-main").textContent(),
    /A sentence about the walrus\./,
  );
  await pane.locator(".search-open:visible").click();
  await page.waitForURL(new RegExp(`${a.base}/r/1.*#second$`));
});

for (const engine of ["chrome", "webkit"])
  test(`on a phone in ${engine}, the filters fit and a tap opens the preview`, async (t) => {
    const { page } = await searchPage(t, {
      engine,
      viewport: { width: 375, height: 760 },
      hasTouch: true,
    });
    if (!page) return;
    await page.locator("#search-button").tap();
    await type(page, "walrus");
    const fit = await page.evaluate(() => {
      const filters = document.querySelector(".search-filters");
      return filters.scrollWidth <= filters.clientWidth;
    });
    assert.ok(fit);
    assert.equal(await page.locator(".search-preview").isVisible(), false);
    await page.locator(".search-row").first().tap();
    await page.locator(".search-back").waitFor();
    assert.equal(await page.locator(".search-preview").isVisible(), true);
    assert.equal(await page.locator(".search-open:visible").count(), 1);
    await page.locator(".search-back").tap();
    assert.equal(await page.locator(".search-preview").isVisible(), false);
    assert.equal(await page.locator(".search-row").count(), 1);
    await page.locator(".search-cancel").tap();
    assert.equal(await page.locator("#search-dialog[open]").count(), 0);
  });
