import assert from "node:assert/strict";
import { test } from "node:test";
import { pages, searchPage, selectedIndex, type } from "../support/search.mjs";

// Each word is on a paragraph of its own, far enough down that the frame has to
// scroll to reach it.
const longPage = {
  id: "long",
  title: "Long",
  html: Array.from(
    { length: 40 },
    (_, number) =>
      `<p>${{ 20: "The quokka", 30: "The narwhal" }[number] ?? "Filler"} paragraph.</p>`,
  ).join(""),
};
const phone = (engine, height = 760) => ({
  engine,
  viewport: { width: 375, height },
  hasTouch: true,
  pages: [...pages, longPage],
});

// Playwright can't raise a phone's keyboard, so these tests give the visual
// viewport the short height a keyboard leaves, and fire its resize event. A test
// with no short height, as with a hardware keyboard, keeps the split.
const stubKeyboard = (page) =>
  page.evaluate(() => {
    window.setKeyboard = (height) => {
      Object.defineProperty(visualViewport, "height", {
        value: height ?? innerHeight,
        configurable: true,
      });
      visualViewport.dispatchEvent(new Event("resize"));
    };
  });
const keyboard = (page, height = null) =>
  page.evaluate((height) => window.setKeyboard(height), height);

async function openSearch(t, options, height) {
  const { page } = await searchPage(t, options);
  if (!page) return null;
  await stubKeyboard(page);
  await page.locator("#search-button").tap();
  await keyboard(page, height);
  return page;
}

// Whether the shown frame has the word highlighted inside its window, seen or not.
const wordInFrame = (word) => {
  const win = document.querySelector(".search-frame.is-shown")?.contentWindow;
  const marks = win?.CSS.highlights?.get("plan-search");
  return (
    marks &&
    [...marks].some((range) => {
      const box = range.getBoundingClientRect();
      return (
        range.toString().toLowerCase() === word &&
        box.width > 0 &&
        box.top >= 0 &&
        box.bottom <= win.innerHeight
      );
    })
  );
};

const previewVisible = (page) => page.locator(".search-preview").isVisible();
const dialogOpen = (page) =>
  page.locator("#search-dialog").evaluate((dialog) => dialog.open);
const previewDone = (page) =>
  page.waitForFunction(
    () =>
      document.querySelector(".search-frame.is-shown") &&
      !document.querySelector(".is-loading"),
  );

for (const engine of ["chrome", "webkit"]) {
  test(`on a phone in ${engine}, only the results show while the keyboard is up, and the best result shows the moment it drops`, async (t) => {
    const page = await openSearch(t, phone(engine), 400);
    if (!page) return;
    // A long list reaches the keyboard.
    await type(page, "llama");
    const listBox = await page.locator(".search-list").boundingBox();
    assert.equal(listBox.y + listBox.height, 400);

    await type(page, "narwhal");
    await page.waitForFunction(wordInFrame, "narwhal");

    // The frame reached the words at its real width, with nothing on screen.
    const up = await page.evaluate(() => ({
      rowTop: document.querySelector(".search-row").getBoundingClientRect().top,
      frameWidth: document.querySelector(".search-frame.is-shown").contentWindow
        .innerWidth,
    }));
    assert.equal(await previewVisible(page), false);
    assert.equal(
      await page.locator(".search-frame.is-shown").isVisible(),
      false,
    );
    assert.equal(up.frameWidth, 375);

    // The split shows in the task that handles the resize, so nothing blank paints
    // between the keyboard and the result.
    const down = await page.evaluate(() => {
      window.setKeyboard(null);
      const frame = document.querySelector(".search-frame.is-shown");
      return {
        previewTop: document
          .querySelector(".search-preview")
          .getBoundingClientRect().top,
        rowTop: document.querySelector(".search-row").getBoundingClientRect()
          .top,
        frameWidth: frame.contentWindow.innerWidth,
        frameVisible: frame.checkVisibility({ visibilityProperty: true }),
        waiting: Boolean(document.querySelector(".is-loading, .is-stale")),
      };
    });
    assert.deepEqual(down, {
      previewTop: 380,
      rowTop: up.rowTop,
      frameWidth: 375,
      frameVisible: true,
      waiting: false,
    });
    assert.ok(await page.evaluate(wordInFrame, "narwhal"));
  });

  test(`on a phone in ${engine}, a tap while typing drops the keyboard and shows the row, and a tap on the row showing opens it`, async (t) => {
    const page = await openSearch(t, phone(engine), 400);
    if (!page) return;
    const field = page.locator(".search-input");
    const row = page.locator(".search-row").nth(1);
    const fieldFocused = () =>
      field.evaluate((input) => document.activeElement === input);
    await type(page, "about");

    // Another row: the keyboard's drop brings the split back with that row.
    await row.tap();
    assert.equal(await fieldFocused(), false);
    await keyboard(page);
    assert.equal(await previewVisible(page), true);
    assert.equal(await selectedIndex(page), "1");
    await previewDone(page);

    // The selected row, typing again: it isn't showing, so the tap doesn't open it.
    await field.tap();
    await keyboard(page, 400);
    assert.equal(await previewVisible(page), false);
    await row.tap();
    assert.equal(await dialogOpen(page), true);
    assert.equal(await fieldFocused(), false);

    // Once it's showing, the tap opens it.
    await keyboard(page);
    await row.tap();
    assert.equal(await dialogOpen(page), false);
  });

  test(`on a phone in ${engine}, a keyboard taller than half the window leaves the field and results in place while the preview moves`, async (t) => {
    const page = await openSearch(t, phone(engine), 300);
    if (!page) return;
    const firstRowTop = () =>
      page
        .locator(".search-row")
        .evaluate((row, { top } = row.getBoundingClientRect()) => top);
    await type(page, "quokka");
    await page.waitForFunction(wordInFrame, "quokka");
    const top = await firstRowTop();
    await type(page, "narwhal");
    await page.waitForFunction(wordInFrame, "narwhal");
    assert.equal(await firstRowTop(), top);
  });
}

test("on a phone, the row a tap chose stays in the results when the split shrinks them", async (t) => {
  // A short keyboard leaves more of the list to tap in than the split keeps.
  const page = await openSearch(t, phone("chrome", 844), 600);
  if (!page) return;
  await type(page, "llama");
  const lowest = await page.evaluate(() => {
    const { bottom } = document
      .querySelector(".search-list")
      .getBoundingClientRect();
    return [...document.querySelectorAll(".search-row")]
      .filter((row) => row.getBoundingClientRect().bottom <= bottom)
      .at(-1).dataset.i;
  });
  await page.locator(`.search-row[data-i="${lowest}"]`).tap();
  await keyboard(page);
  const fits = await page.evaluate(() => {
    const list = document.querySelector(".search-list").getBoundingClientRect();
    const row = document
      .querySelector('.search-row[aria-selected="true"]')
      .getBoundingClientRect();
    return row.top >= list.top && row.bottom <= list.bottom;
  });
  assert.equal(fits, true);
});

test("a wide window with a keyboard up keeps both panes, and a click on the row showing opens it", async (t) => {
  const { page } = await searchPage(t, {
    viewport: { width: 1000, height: 800 },
  });
  if (!page) return;
  await stubKeyboard(page);
  await page.locator("#search-button").click();
  await keyboard(page, 400);
  await type(page, "walrus");
  await previewDone(page);
  assert.equal(await previewVisible(page), true);
  assert.equal(await page.locator(".search-frame.is-shown").isVisible(), true);
  await page.locator(".search-row").first().click();
  assert.equal(await dialogOpen(page), false);
});
