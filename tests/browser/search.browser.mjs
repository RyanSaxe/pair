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
  {
    id: "many",
    title: "Many blocks",
    html: Array.from(
      { length: 12 },
      (_, number) => `<p>A llama numbered ${number}.</p>`,
    ).join(""),
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
});

test("inside the modal, Ctrl+J and Ctrl+K move on every system, and Ctrl+K never closes it", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const selectedIndex = () =>
    page.locator('.search-row[aria-selected="true"]').getAttribute("data-i");
  await page.keyboard.press("/");
  await type(page, "about");
  for (const [key, index] of [
    ["Control+j", "1"],
    ["Control+k", "0"],
    ["Control+n", "1"],
    ["Control+p", "0"],
    ["ArrowDown", "1"],
    ["ArrowUp", "0"],
  ]) {
    await page.keyboard.press(key);
    assert.equal(await selectedIndex(), index, key);
    assert.equal(await page.locator("#search-dialog[open]").count(), 1, key);
  }
  // With no element focused, as after a tap on a row, the keys still reach it.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Control+j");
  assert.equal(await selectedIndex(), "1");
  await page.keyboard.press("Control+k");
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  if (process.platform === "darwin") {
    await page.keyboard.press("Meta+k");
    await page
      .locator("#search-dialog:not([open])")
      .waitFor({ state: "attached" });
  }
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

test("a click outside the kinds menu only closes it, and the keys stay in the menu while it is open", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const address = page.url();
  const selectedIndex = () =>
    page.locator('.search-row[aria-selected="true"]').getAttribute("data-i");
  await page.locator("#search-button").click();
  await type(page, "about");

  await page.locator(".search-kinds-button").click();
  const rowBox = await page.locator(".search-row").first().boundingBox();
  await page.mouse.click(
    rowBox.x + rowBox.width - 4,
    rowBox.y + rowBox.height - 4,
  );
  assert.equal(await page.locator(".search-kinds").isVisible(), false);
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  assert.equal(page.url(), address);

  // The arrows move through the menu, and Enter toggles a kind and opens nothing.
  await page.locator(".search-kinds-button").click();
  await page.keyboard.press("ArrowDown");
  assert.equal(await selectedIndex(), "0");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector(".search-kinds-button").textContent === "Pages",
  );
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  assert.equal(page.url(), address);
});

test("typing goes to the field after the menu closes, after a click on nothing, and from a control", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const field = () => page.inputValue(".search-input");
  await page.locator("#search-button").click();
  await type(page, "ab");

  await page.locator(".search-kinds-button").click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("o");
  assert.equal(await field(), "abo");

  await page.locator(".search-kinds-button").click();
  await page.locator(".search-kinds-button").click();
  await page.keyboard.type("u");
  assert.equal(await field(), "abou");

  await page.locator(".search-session").click();
  await page.keyboard.type("t");
  assert.equal(await field(), "about");

  await page.locator(".search-open").focus();
  await page.keyboard.type("s");
  assert.equal(await field(), "abouts");
});

test("Tab moves through the modal's controls, and each works by key", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const focused = () =>
    page.evaluate(() => document.activeElement.textContent.trim());
  await page.locator("#search-button").click();
  await type(page, "about");
  for (const label of ["This session", "All rounds", "All kinds"]) {
    await page.keyboard.press("Tab");
    assert.equal(await focused(), label);
  }
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".search-kinds").isVisible(), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".search-kinds").isVisible(), false);
  assert.match(await focused(), /^Open/);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-toggle="allRounds"]').textContent ===
      "Latest round",
  );
  assert.equal(await focused(), "Latest round");
});

test("the selection holds while the pointer heads for Open, and follows the pointer through the list", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const selectedIndex = () =>
    page.locator('.search-row[aria-selected="true"]').getAttribute("data-i");
  const rowAt = async (index, along = 0.5) => {
    const box = await page.locator(".search-row").nth(index).boundingBox();
    return [box.x + box.width * along, box.y + box.height / 2];
  };
  await page.locator("#search-button").click();
  await type(page, "llama");

  // Down through the list, the selection follows the pointer.
  await page.mouse.move(...(await rowAt(0)));
  await page.mouse.move(...(await rowAt(6)), { steps: 12 });
  assert.equal(await selectedIndex(), "6");

  // On the way to Open, the path crosses the rows above the selected one.
  const open = await page.locator(".search-open:visible").boundingBox();
  await page.mouse.move(open.x + 10, open.y + 10, { steps: 24 });
  assert.equal(await selectedIndex(), "6");

  // Up through the list, it follows again, and a pointer that heads right and
  // stops selects the row it stopped on.
  await page.mouse.move(...(await rowAt(1, 0.2)), { steps: 12 });
  assert.equal(await selectedIndex(), "1");
  await page.mouse.move(...(await rowAt(2, 0.8)), { steps: 8 });
  await page.waitForFunction(
    () =>
      document.querySelector('.search-row[aria-selected="true"]').dataset.i ===
      "2",
  );
});

test("a drag from the preview to the backdrop leaves the modal open", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await type(page, "walrus");
  const box = await page.locator(".search-preview-main").boundingBox();
  await page.mouse.move(box.x + 30, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, 4, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  await page.mouse.click(4, 4);
  assert.equal(await page.locator("#search-dialog[open]").count(), 0);
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
    await pane.locator(".search-place").textContent(),
    /Second page/,
  );
  assert.match(
    await pane.locator(".search-preview-main").textContent(),
    /A sentence about the walrus\./,
  );
  await pane.locator(".search-open:visible").click();
  await page.waitForURL(new RegExp(`${a.base}/r/1.*#second$`));
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
    const first = await preview.locator(".search-text").textContent();
    await page.locator(".search-row").nth(1).tap();
    assert.notEqual(await preview.locator(".search-text").textContent(), first);
    assert.equal(await list.isVisible(), true);

    await page.locator(".search-input").tap();
    assert.equal(await preview.isVisible(), false);
    assert.equal(await page.locator(".search-row").count(), 2);
    await page.locator(".search-close").tap();
    assert.equal(await page.locator("#search-dialog[open]").count(), 0);
  });
