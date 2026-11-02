import assert from "node:assert/strict";
import crypto from "node:crypto";
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
// with no short height, as with a hardware keyboard, keeps the split. A pan is
// how far iOS has moved the page to reach a field.
const stubKeyboard = (page) =>
  page.evaluate(() => {
    window.setKeyboard = (height, pan = 0) => {
      Object.defineProperty(visualViewport, "height", {
        value: height ?? innerHeight,
        configurable: true,
      });
      Object.defineProperty(visualViewport, "offsetTop", {
        value: pan,
        configurable: true,
      });
      visualViewport.dispatchEvent(new Event("resize"));
    };
  });
const keyboard = (page, height = null, pan = 0) =>
  page.evaluate(
    ([height, pan]) => window.setKeyboard(height, pan),
    [height, pan],
  );

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

const shownFrame = (page) => page.frameLocator(".search-frame.is-shown");
// A part of the shown frame has to be whole on screen, inside the frame, the
// scrolling boxes around it and the height the keyboard leaves. Rounding can cost
// it a fraction of a pixel. A frame that just changed height fires its resize event
// in its next rendering.
async function wholeOnScreen(page, selector) {
  const { shown, whole } = await page.evaluate(async (selector) => {
    for (const _ of [1, 2]) await new Promise(requestAnimationFrame);
    const frame = document.querySelector(".search-frame.is-shown");
    const part = frame.contentDocument.querySelector(selector);
    const whole = part.getBoundingClientRect().height;
    if (!frame.checkVisibility({ visibilityProperty: true }))
      return { shown: 0, whole };
    const outer = frame.getBoundingClientRect();
    const { offsetTop, height } = visualViewport;
    let from = Math.max(outer.top, offsetTop);
    let to = Math.min(outer.bottom, offsetTop + height);
    for (let box = part; box; box = box.parentElement) {
      if (box !== part && getComputedStyle(box).overflowY === "visible")
        continue;
      const { top, bottom } = box.getBoundingClientRect();
      from = Math.max(from, top + outer.top);
      to = Math.min(to, bottom + outer.top);
    }
    return { shown: Math.max(0, to - from), whole };
  }, selector);
  assert.ok(shown >= whole - 1, `${selector} shows ${shown}px of ${whole}px`);
}
const previewCovers = (page, { top, bottom }) =>
  page.waitForFunction(
    ({ top, bottom }) => {
      const preview = document.querySelector(".search-preview");
      const box = preview.getBoundingClientRect();
      return (
        preview.checkVisibility({ visibilityProperty: true }) &&
        box.top === top &&
        box.bottom === bottom
      );
    },
    { top, bottom },
  );
const onlyResults = (page) =>
  page.waitForFunction(
    () =>
      !document
        .querySelector(".search-preview")
        .checkVisibility({ visibilityProperty: true }),
  );
// The preview in the bottom half of the modal, under the results.
const splitShows = (page) =>
  page.waitForFunction(() => {
    const preview = document.querySelector(".search-preview");
    const modal = document
      .querySelector("#search-dialog")
      .getBoundingClientRect();
    return (
      preview.checkVisibility({ visibilityProperty: true }) &&
      preview.getBoundingClientRect().top === modal.top + modal.height / 2
    );
  });

async function showResult(page, word) {
  await type(page, word);
  await page.waitForFunction(wordInFrame, word);
  await page.locator(".search-input").blur();
}
async function showNote(t, engine) {
  const page = await openSearch(t, phone(engine));
  if (!page) return null;
  await showResult(page, "narwhal");
  await shownFrame(page).locator("#page-content p").first().click();
  await shownFrame(page).locator("#comment-here").click();
  await shownFrame(page).locator("#note-text").waitFor();
  return page;
}
const noteClosed = (page) =>
  page.waitForFunction(
    () =>
      !document
        .querySelector(".search-frame.is-shown")
        .contentDocument.getElementById("note-dialog").open,
  );

// A photo from a real iPhone showed 280px above the keyboard, and the page panned
// 60px to reach the note's field. On that phone the window's height had fallen
// with the keyboard's, which the first keyboard here does for real.
const KEYBOARDS = {
  "the window shrinks with the keyboard": {
    up: async (page) => {
      // The real viewport follows the window, so the stub comes off.
      await page.evaluate(() => {
        delete visualViewport.height;
        delete visualViewport.offsetTop;
      });
      await page.setViewportSize({ width: 375, height: 280 });
      return { top: 0, bottom: 280 };
    },
    down: (page) => page.setViewportSize({ width: 375, height: 760 }),
  },
  "only the visual viewport shrinks": {
    up: async (page) => {
      await keyboard(page, 280, 60);
      return { top: 60, bottom: 340 };
    },
    down: (page) => keyboard(page),
  },
};

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
    // The results stay until the keyboard has dropped, with no split on its way.
    await keyboard(page, 500);
    assert.equal(await previewVisible(page), false);
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

  for (const [name, { up, down }] of Object.entries(KEYBOARDS)) {
    test(`on a phone in ${engine}, when ${name}, a note in the preview has the window, and saving it brings the split back`, async (t) => {
      const page = await showNote(t, engine);
      if (!page) return;
      await previewCovers(page, await up(page));
      for (const part of ["#note-title", "#note-text", "#note-save"])
        await wholeOnScreen(page, part);

      const text = shownFrame(page).locator("#note-text");
      await text.pressSequentially("A narwhal note");
      await wholeOnScreen(page, "#note-text");
      assert.equal(await page.inputValue(".search-input"), "narwhal");
      await shownFrame(page).locator("#note-save").click();
      await noteClosed(page);
      // The split is back before the keyboard has dropped.
      await splitShows(page);
      await down(page);
      await previewCovers(page, { top: 380, bottom: 760 });
    });
  }

  test(`on a phone in ${engine}, when the window shrinks with the keyboard, only the results show while typing in the search field, and the best result shows when it drops`, async (t) => {
    const { page } = await searchPage(t, phone(engine));
    if (!page) return;
    await page.locator("#search-button").tap();
    await page.setViewportSize({ width: 375, height: 400 });
    await onlyResults(page);
    await type(page, "narwhal");
    await page.waitForFunction(wordInFrame, "narwhal");
    assert.equal(await previewVisible(page), false);

    await page.setViewportSize({ width: 375, height: 760 });
    await previewCovers(page, { top: 380, bottom: 760 });
    assert.equal(
      await page.locator(".search-frame.is-shown").isVisible(),
      true,
    );
    assert.ok(await page.evaluate(wordInFrame, "narwhal"));
  });

  test(`on a phone in ${engine}, a rotation is no keyboard, with the search field's focus or with none`, async (t) => {
    const { page } = await searchPage(t, {
      ...phone(engine),
      viewport: { width: 375, height: 660 },
    });
    if (!page) return;
    await page.locator("#search-button").tap();
    await type(page, "narwhal");
    for (const [width, height] of [
      [660, 375],
      [375, 660],
    ]) {
      await page.setViewportSize({ width, height });
      await previewCovers(page, { top: height / 2, bottom: height });
    }
    await page.locator(".search-input").blur();
    await page.setViewportSize({ width: 660, height: 375 });
    await previewCovers(page, { top: 375 / 2, bottom: 375 });
  });

  test(`on a phone in ${engine}, a window a person shrinks leaves the split, or brings it back once the search field loses focus`, async (t) => {
    const { page } = await searchPage(t, phone(engine));
    if (!page) return;
    await page.locator("#search-button").tap();
    await type(page, "narwhal");
    await page.setViewportSize({ width: 375, height: 400 });
    await onlyResults(page);
    await page.locator(".search-input").blur();
    await previewCovers(page, { top: 200, bottom: 400 });

    await page.setViewportSize({ width: 375, height: 760 });
    await page.setViewportSize({ width: 375, height: 400 });
    await previewCovers(page, { top: 200, bottom: 400 });
  });

  test(`on a phone in ${engine}, a note closed with no save brings the split back, and the search field's keyboard still shows only the results`, async (t) => {
    const page = await showNote(t, engine);
    if (!page) return;
    await keyboard(page, 280);
    await wholeOnScreen(page, "#note-text");
    await shownFrame(page).getByRole("button", { name: "Close note" }).click();
    await noteClosed(page);
    await splitShows(page);
    await keyboard(page);
    await previewCovers(page, { top: 380, bottom: 760 });

    await page.locator(".search-input").tap();
    await keyboard(page, 400);
    assert.equal(await previewVisible(page), false);
    await page.locator(".search-input").blur();
    await keyboard(page);
    await splitShows(page);
  });

  test(`on a phone in ${engine}, a reply box in the preview has the window, and leaving it brings the split back`, async (t) => {
    const { a, page } = await searchPage(t, phone(engine));
    if (!page) return;
    const started = await a.request(`${a.base}/api/threads`, {
      id: crypto.randomUUID(),
      round: "1",
      topic: "overview",
      anchor: "Overview",
      target: "block-overview-1",
      text: "Does the wombat retry?",
    });
    assert.equal(started.code, 201);
    await stubKeyboard(page);
    await page.locator("#search-button").tap();
    await showResult(page, "wombat");

    const box = "form.thread-reply textarea";
    await shownFrame(page).locator(box).click();
    await keyboard(page, 280, 60);
    await previewCovers(page, { top: 60, bottom: 340 });
    await wholeOnScreen(page, box);
    await shownFrame(page).locator(box).pressSequentially("It retries");
    await wholeOnScreen(page, box);

    await shownFrame(page).locator(box).blur();
    await keyboard(page);
    await previewCovers(page, { top: 380, bottom: 760 });
    assert.equal(
      await shownFrame(page).locator(box).inputValue(),
      "It retries",
    );
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

test("a wide window keeps both panes where they were while a note in the preview is open", async (t) => {
  const { page } = await searchPage(t, {
    viewport: { width: 1000, height: 800 },
  });
  if (!page) return;
  await page.locator("#search-button").click();
  await type(page, "walrus");
  await previewDone(page);
  const place = () =>
    page.evaluate(() =>
      ["#search-dialog", ".search-left", ".search-preview-main"].map(
        (selector) => {
          const { x, y, width, height } = document
            .querySelector(selector)
            .getBoundingClientRect();
          return { x, y, width, height };
        },
      ),
    );
  const before = await place();
  await shownFrame(page).locator("#page-content p").first().click();
  await shownFrame(page).locator("#comment-here").click();
  await shownFrame(page).locator("#note-text").waitFor();
  assert.deepEqual(await place(), before);
});
