import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";
import { pages, searchPage, selected, type } from "../support/search.mjs";

test("the icon opens search, and typing filters the list as it goes", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await page.locator(".search-row").first().waitFor();
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

test("the words, filters, kinds and selected row survive reopening and moving to another session in the tab", async (t) => {
  const { h, page } = await searchPage(t);
  if (!page) return;
  const other = await h.session();
  const published = await other.publish({
    ...planData("1", "other"),
    pages: [
      {
        id: "elsewhere",
        title: "Elsewhere",
        html: "<p>Nothing about the animals.</p>",
      },
    ],
  });
  assert.equal(published.code, 200, published.body.error);
  const selectedRow = () =>
    page.locator('.search-row[aria-selected="true"] .search-snippet');
  const answered = () =>
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/search",
    );
  await page.locator("#search-button").click();
  await type(page, "about");
  await page.keyboard.press("Alt+KeyS");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-toggle="allSessions"]').textContent ===
      "All sessions",
  );
  await page.locator(".search-kinds-button").click();
  await page.locator('.search-kind[data-kind="pages"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector(".search-kinds-button").textContent === "Pages",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const chosen = await selectedRow().textContent();
  assert.equal(await page.locator(".search-row").count(), 3);

  await page.keyboard.press("Escape");
  const reopened = answered();
  await page.keyboard.press("/");
  await reopened;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await selectedRow().textContent(), chosen);

  await page.goto(`${h.server.origin}${other.base}/#elsewhere`);
  await page.locator("#search-button").waitFor();
  const moved = answered();
  await page.locator("#search-button").click();
  await moved;
  await page.locator(".search-row").first().waitFor();
  assert.equal(await page.inputValue(".search-input"), "about");
  assert.equal(
    await page.locator('[data-toggle="allSessions"]').textContent(),
    "All sessions",
  );
  assert.equal(
    await page.locator(".search-kinds-button").textContent(),
    "Pages",
  );
  assert.equal(await selectedRow().textContent(), chosen);
});

test("search works where the browser refuses its storage", async (t) => {
  const page = await open(t, "about:blank");
  if (!page) return;
  const h = await hub(t);
  const a = await h.session();
  const published = await a.publish({ ...planData(), pages });
  assert.equal(published.code, 200, published.body.error);
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("Refused", "SecurityError");
      },
    });
  });
  await stubPele(page);
  await page.goto(`${h.server.origin}${a.base}/#overview`);
  await page.locator("#search-button").click();
  await type(page, "walrus");
  assert.equal(await page.locator(".search-row").count(), 1);
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
  assert.equal(await button.textContent(), "2 kinds");
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
  // Enter takes the offer.
  await page.locator(".search-input").press("Enter");
  await page.locator(".search-row").first().waitFor();
  assert.equal(await page.inputValue(".search-input"), "walrus");
  assert.equal(
    await page.locator(".search-kinds-button").textContent(),
    "All kinds",
  );
});

test("with nothing typed, a kind or round filter that hides everything says so and loosens", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const blank = page.locator(".search-blank");
  await page.locator("#search-button").click();
  await page.locator(".search-row").first().waitFor();
  await page.locator(".search-kinds-button").click();
  await page.locator('.search-kind[data-kind="threads"]').click();
  await blank.waitFor();
  assert.match(await blank.textContent(), /No threads in this session\./);
  await page.keyboard.press("Escape");
  await blank.locator("[data-wider]").click();
  await page.locator(".search-row").first().waitFor();
  assert.equal(
    await page.locator(".search-kinds-button").textContent(),
    "All kinds",
  );
});

test("a slow search leaves no message about the words it replaced, and a failed one shows no count", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const blank = page.locator(".search-blank");
  await page.locator("#search-button").click();
  await type(page, "zzzzzz");
  await blank.waitFor();
  assert.match(await blank.textContent(), /zzzzzz/);

  let answer;
  const held = new Promise((resolve) => (answer = resolve));
  await page.route(/\/api\/search\?q=walrus&/, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.fill(".search-input", "walrus");
  await page.waitForFunction(
    () => !document.querySelector(".search-blank").textContent.includes("zzz"),
    null,
    { timeout: 5000 },
  );
  assert.equal(await page.locator(".search-count").textContent(), "");
  answer();
  await page.locator(".search-row").first().waitFor();

  await page.route(/\/api\/search\?q=lemur&/, (route) => route.abort());
  await page.fill(".search-input", "lemur");
  await page.locator(".search-blank").waitFor();
  assert.equal(await page.locator(".search-count").textContent(), "");
  assert.equal(await page.locator(".search-preview-head").isVisible(), false);
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

test("the preview's head names the result's place, and Open goes there", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await type(page, "walrus");
  const pane = page.locator(".search-preview");
  assert.match(
    await pane.locator(".search-place").textContent(),
    /Second page/,
  );
  await pane.locator(".search-open:visible").click();
  await page.waitForFunction(() => location.hash === "#second");
  assert.equal(await page.locator("#search-dialog[open]").count(), 0);
});

test("the filters, the count and a long query's message fit the results at the narrowest windows", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await page.locator('[data-toggle="allSessions"]').click();
  await page.locator('[data-toggle="allRounds"]').click();
  await page.locator(".search-kinds-button").click();
  await page.locator('.search-kind[data-kind="proposals"]').click();
  await page.keyboard.press("Escape");
  const fits = () =>
    page.evaluate(() => {
      const left = document.querySelector(".search-left");
      const count = document.querySelector(".search-count");
      const list = document.querySelector(".search-list");
      const lastFilter = document.querySelector(".search-kinds-button");
      return {
        filters:
          lastFilter.getBoundingClientRect().right <=
          left.getBoundingClientRect().right,
        count: count.scrollWidth <= count.clientWidth,
        list: list.scrollWidth <= list.clientWidth,
      };
    });
  const fitting = { filters: true, count: true, list: true };
  for (const width of [721, 375]) {
    await page.setViewportSize({ width, height: 760 });
    await type(page, "about");
    assert.deepEqual(await fits(), fitting, `${width}, a short query`);
    await type(page, `http://example.test/${"nothing".repeat(30)}`);
    assert.deepEqual(await fits(), fitting, `${width}, an unbroken query`);
  }
});

for (const engine of ["chrome", "webkit"])
  test(`on a phone in ${engine}, a tap shows the preview under the results, and the field returns to the results alone`, async (t) => {
    const { page } = await searchPage(t, {
      engine,
      viewport: { width: 375, height: 760 },
      hasTouch: true,
    });
    if (!page) return;
    const preview = page.locator(".search-preview");
    const list = page.locator(".search-list");
    const fieldFocused = () =>
      page.evaluate(
        () =>
          document.activeElement === document.querySelector(".search-input"),
      );
    await page.locator("#search-button").tap();
    await type(page, "about");
    assert.equal(await preview.isVisible(), false);

    // The keyboard's Search key drops the keyboard over the results.
    await page.locator(".search-input").press("Enter");
    assert.equal(await page.locator("#search-dialog[open]").count(), 1);
    assert.equal(await fieldFocused(), false);
    assert.equal(await preview.isVisible(), false);

    await page.locator(".search-input").tap();
    await page.locator(".search-row").first().tap();
    assert.equal(await fieldFocused(), false);
    const [listBox, previewBox] = [
      await list.boundingBox(),
      await preview.boundingBox(),
    ];
    assert.ok(previewBox.y >= 760 / 2 - 2 && previewBox.y <= 760 / 2 + 2);
    assert.ok(listBox.y + listBox.height <= previewBox.y + 1);
    assert.equal(await page.locator(".search-open:visible").count(), 1);
    // The next result is one tap, with the results still above.
    const blockText = () =>
      [
        ...document
          .querySelector(".search-frame.is-shown")
          .contentDocument.querySelectorAll("#page-content > *"),
      ]
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => element.textContent)
        .join(" ");
    await page.locator(".search-frame.is-shown").waitFor();
    const first = await page.evaluate(blockText);
    await page.locator(".search-row").nth(1).tap();
    await waitUntil(async () => (await page.evaluate(blockText)) !== first);
    assert.equal(await list.isVisible(), true);

    await page.locator(".search-input").tap();
    assert.equal(await preview.isVisible(), false);
    assert.equal(await page.locator(".search-row").count(), 2);
    await page.locator(".search-close").tap();
    assert.equal(await page.locator("#search-dialog[open]").count(), 0);
  });
