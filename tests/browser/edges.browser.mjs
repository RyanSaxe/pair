import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import {
  blueLine,
  box,
  drag,
  fullIs,
  moveTo,
  near,
  PAGE_KEY,
  press,
  save,
  saved,
  setup,
  SIDEBAR_KEY,
  tab,
  wide,
  Y,
} from "../support/edges.mjs";
import { hub } from "../support/hub.mjs";

const engines = { Chrome: "chrome", WebKit: "webkit" };
for (const [browser, engine] of Object.entries(engines)) {
  test(`in ${browser}, dragging either page edge moves both, the grabbed edge follows the pointer, and text and blocks widen with it`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    const start = await box(page, "#app");
    assert.equal(start.width, 1160);
    const blocks = async () => ({
      words: (await box(page, "#words")).width,
      code: (await box(page, "#page-content [data-language]")).width,
      prototype: (await box(page, ".approved-prototype")).width,
    });
    const before = await blocks();
    assert.equal(before.words, 822);

    await press(page, start.right);
    await moveTo(page, 1800);
    let app = await box(page, "#app");
    near(app.right, 1800, "the grabbed right edge");
    near(app.left, 200, "the other edge");
    const after = await blocks();
    assert.ok(after.words > before.words + 400, JSON.stringify(after));
    assert.ok(after.code > before.code + 400, JSON.stringify(after));
    assert.ok(after.prototype > before.prototype + 400, JSON.stringify(after));
    await page.mouse.up();

    await press(page, app.left - 1);
    await moveTo(page, 100);
    app = await box(page, "#app");
    near(app.left, 100, "the grabbed left edge");
    near(app.right, 1900, "the other edge");
    await page.mouse.up();
  });

  test(`in ${browser}, the page clamps to 1160px and the window, and its tabs flip inward at full width, sit flush on the line and drag back`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    const start = await box(page, "#app");
    assert.equal((await tab(page, "left")).right, start.left);
    assert.equal((await tab(page, "right")).left, start.right);

    await drag(page, start.right, 1100);
    assert.equal((await box(page, "#app")).width, 1160);

    await press(page, start.right);
    await moveTo(page, 1990);
    assert.equal((await box(page, "#app")).width, 2000);
    await fullIs(page, true);
    // The line is the page's first pixel, or its last at the right.
    assert.equal(await blueLine(page, "right"), wide.width - 1);
    await page.mouse.up();
    assert.deepEqual(await tab(page, "left"), { left: 1, right: 4 });
    assert.deepEqual(await tab(page, "right"), {
      left: wide.width - 4,
      right: wide.width - 1,
    });

    await drag(page, 5, 300);
    const back = await box(page, "#app");
    near(back.left, 300, "the left edge dragged back");
    await fullIs(page, false);
    assert.equal((await tab(page, "left")).right, back.left);
  });

  test(`in ${browser}, a page within 5px of the window's width flips its tabs, so each stays on screen and flush on its line`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    for (const width of [1161, 1163, 1165]) {
      await page.setViewportSize({ width, height: 900 });
      await fullIs(page, true);
      const app = await box(page, "#app");
      assert.deepEqual(
        await tab(page, "left"),
        { left: app.left + 1, right: app.left + 4 },
        `the left tab in a ${width}px window`,
      );
      assert.deepEqual(
        await tab(page, "right"),
        { left: app.right - 4, right: app.right - 1 },
        `the right tab in a ${width}px window`,
      );
    }
    await page.setViewportSize({ width: 1166, height: 900 });
    await fullIs(page, false);
    const app = await box(page, "#app");
    assert.deepEqual(await tab(page, "left"), {
      left: app.left - 3,
      right: app.left,
    });
    assert.ok(app.left - 3 >= 0, "the left tab fits in the window");
    assert.deepEqual(await tab(page, "right"), {
      left: app.right,
      right: app.right + 3,
    });
    assert.ok(app.right + 3 <= 1166, "the right tab fits in the window");
  });

  test(`in ${browser}, a release saves the width, a reload restores it, a smaller window shrinks the page and a larger one returns it, and a double-click resets it`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    const { right } = await box(page, "#app");

    // A press with no movement writes nothing.
    await press(page, right);
    await page.mouse.up();
    assert.equal(await saved(page, PAGE_KEY), null);

    await press(page, right);
    await moveTo(page, 1800);
    assert.equal(await saved(page, PAGE_KEY), null, "saved only on release");
    await page.mouse.up();
    assert.equal(await saved(page, PAGE_KEY), "1600");

    await page.reload();
    await page.locator('#page-content[data-page-id="blocks"]').waitFor();
    assert.equal((await box(page, "#app")).width, 1600);

    await page.setViewportSize({ width: 1300, height: 900 });
    assert.equal((await box(page, "#app")).width, 1300);
    await fullIs(page, true);
    assert.equal(await saved(page, PAGE_KEY), "1600");
    await page.setViewportSize(wide);
    assert.equal((await box(page, "#app")).width, 1600);
    await fullIs(page, false);

    await page.mouse.dblclick(1800, Y);
    assert.equal((await box(page, "#app")).width, 1160);
    assert.equal(await saved(page, PAGE_KEY), null);
  });

  test(`in ${browser}, a saved width that is not a whole number in range is ignored at load`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    for (const [pageWidth, sidebarWidth] of [
      ["wide", "narrow"],
      ["1160", "224"],
      ["1500.5", "300.5"],
      ["-1600", "401"],
    ]) {
      await save(page, { [PAGE_KEY]: pageWidth, [SIDEBAR_KEY]: sidebarWidth });
      await page.reload();
      await page.locator('#page-content[data-page-id="blocks"]').waitFor();
      assert.equal((await box(page, "#app")).width, 1160, pageWidth);
      assert.equal((await box(page, "#sidebar")).width, 224, sidebarWidth);
    }
  });

  test(`in ${browser}, no grip shows at 1160px or at 375px, and a saved sidebar width applies only above 1160px`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    await save(page, { [PAGE_KEY]: "1600", [SIDEBAR_KEY]: "300" });
    await page.reload();
    await page.locator('#page-content[data-page-id="blocks"]').waitFor();
    const grips = () =>
      Promise.all(
        ["left", "right", "side"].map((side) =>
          page.locator(`.grip.${side}`).isVisible(),
        ),
      );
    assert.deepEqual(await grips(), [true, true, true]);
    assert.equal((await box(page, "#sidebar")).width, 300);

    await page.setViewportSize({ width: 1160, height: 900 });
    assert.deepEqual(await grips(), [false, false, false]);
    assert.equal((await box(page, "#sidebar")).width, 224);
    assert.equal((await box(page, "#app")).width, 1160);

    await page.setViewportSize({ width: 375, height: 760 });
    assert.deepEqual(await grips(), [false, false, false]);
    assert.equal((await box(page, "#sidebar")).width, 272);
    assert.equal((await box(page, "#app")).width, 375);

    // Above 720px the frame opens the sidebar at the browser's next frame.
    await page.setViewportSize({ width: 1161, height: 900 });
    await page.locator(".grip.side").waitFor();
    assert.deepEqual(await grips(), [true, true, true]);
    assert.equal((await box(page, "#sidebar")).width, 300);
  });

  test(`in ${browser}, the sidebar clamps to 224px and 400px, text starts 56px past it, the column follows with no delay, and its grip hides when it closes`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    const sidebar = await box(page, "#sidebar");
    const followed = async (width) => {
      const [now, column, words] = await Promise.all(
        ["#sidebar", ".main-column", "#words"].map((selector) =>
          box(page, selector),
        ),
      );
      assert.equal(now.width, width);
      assert.equal(column.left, now.right, "the column follows at once");
      assert.equal(words.left, now.left + width + 56);
    };

    await press(page, sidebar.right);
    await moveTo(page, sidebar.left + 300);
    await followed(300);
    await moveTo(page, sidebar.left + 900);
    await followed(400);
    await moveTo(page, sidebar.left + 100);
    await followed(224);
    await moveTo(page, sidebar.left + 300);
    await page.mouse.up();
    assert.equal(await saved(page, SIDEBAR_KEY), "300");

    await page.mouse.dblclick(sidebar.left + 300, Y);
    await followed(224);
    assert.equal(await saved(page, SIDEBAR_KEY), null);

    await drag(page, sidebar.right, sidebar.left + 300);
    assert.equal(await saved(page, SIDEBAR_KEY), "300");
    await drag(page, sidebar.left + 300, sidebar.left + 100);
    await followed(224);
    assert.equal(await saved(page, SIDEBAR_KEY), null);

    await page.locator("#sidebar-toggle").click();
    assert.equal(await page.locator(".grip.side").isVisible(), false);
  });

  test(`in ${browser}, a drag that passes over a prototype keeps following the pointer and saves on the release`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    const frame = await page.locator(".approved-prototype").boundingBox();
    const y = frame.y + frame.height / 2;
    const over = frame.x + frame.width / 2;
    const sidebar = await box(page, "#sidebar");

    await press(page, sidebar.right, y);
    await moveTo(page, sidebar.left + 300, y);
    await moveTo(page, over, y);
    assert.equal((await box(page, "#sidebar")).width, 400);
    await moveTo(page, sidebar.left + 300, y);
    assert.equal((await box(page, "#sidebar")).width, 300);
    await moveTo(page, over, y);
    await page.mouse.up();
    assert.equal(await saved(page, SIDEBAR_KEY), "400");
    assert.equal(
      await page.evaluate(() => "edgeDrag" in document.documentElement.dataset),
      false,
    );

    // The page's edge stops at 1160px, so a pointer past it is over the column.
    const { right } = await box(page, "#app");
    await press(page, right, y);
    await moveTo(page, 1800, y);
    near((await box(page, "#app")).right, 1800, "the grabbed edge");
    await moveTo(page, over, y);
    assert.equal((await box(page, "#app")).width, 1160);
    await moveTo(page, 1700, y);
    near((await box(page, "#app")).right, 1700, "the grabbed edge");
    await page.mouse.up();
    assert.equal(await saved(page, PAGE_KEY), "1400");
  });

  test(`in ${browser}, a press on a classic scrollbar's thumb scrolls the page and the sidebar, at rest and with the page filling the window`, async (t) => {
    // Playwright hides scrollbars in headless Chrome unless told otherwise, and
    // the browser ignores ::-webkit-scrollbar while scrollbar-width is set.
    const s = await setup(t, engine, {
      at: "long",
      ignoreDefaultArgs: ["--hide-scrollbars"],
    });
    if (!s) return;
    const { page } = s;
    await page.addStyleTag({
      content: `main, .sidebar { scrollbar-width: auto; scrollbar-color: auto; }
main::-webkit-scrollbar, .sidebar::-webkit-scrollbar { width: 15px; }
main::-webkit-scrollbar-thumb, .sidebar::-webkit-scrollbar-thumb { background: gray; }`,
    });
    // WebKit keeps a pane's scrollbar until the pane stops scrolling.
    await page.evaluate(() => {
      for (const pane of document.querySelectorAll("main, .sidebar")) {
        pane.style.overflow = "hidden";
        void pane.offsetWidth;
        pane.style.overflow = "";
      }
    });
    const scrollbar = (selector) =>
      page
        .locator(selector)
        .evaluate((pane) => pane.offsetWidth - pane.clientWidth);
    const scrollTop = (selector) =>
      page.locator(selector).evaluate((pane) => pane.scrollTop);
    // The thumb starts at the pane's top, so this press is above the tab's
    // height, and inset puts it where the strip would otherwise cover the bar.
    const dragThumb = async (selector, inset) => {
      await page
        .locator(selector)
        .evaluate((pane) => pane.scrollTo({ top: 0, behavior: "instant" }));
      const pane = await box(page, selector);
      const widths = [
        (await box(page, "#app")).width,
        (await box(page, "#sidebar")).width,
      ];
      await press(page, pane.right - inset, pane.top + 10);
      await moveTo(page, pane.right - inset, pane.top + 80);
      await page.mouse.up();
      assert.ok((await scrollTop(selector)) > 0, `${selector} did not scroll`);
      assert.deepEqual(
        [(await box(page, "#app")).width, (await box(page, "#sidebar")).width],
        widths,
      );
    };

    assert.equal(await scrollbar("main"), 15);
    await dragThumb("main", 3);
    await drag(page, (await box(page, "#app")).right, 1990);
    await fullIs(page, true);
    await dragThumb("main", 3);
    assert.equal(await saved(page, PAGE_KEY), String(wide.width));

    // A short window gives the sidebar a scrollbar. The sidebar's border is its
    // last pixel, and the bar is inside it.
    await page.setViewportSize({ width: wide.width, height: 300 });
    assert.equal(await scrollbar("#sidebar"), 16);
    await dragThumb("#sidebar", 4);
    assert.equal(await saved(page, SIDEBAR_KEY), null);
  });

  test(`in ${browser}, a strip's part over a pane is only the tab's height, and the rest of the edge can be grabbed from outside the pane`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    const middle = wide.height / 2;
    const away = 100;
    const grabs = (x, y) =>
      page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest(".grip") !== null,
        [x, y],
      );
    const app = await box(page, "#app");
    const sidebar = await box(page, "#sidebar");
    for (const [label, outside, over] of [
      ["right", app.right + 3, app.right - 4],
      ["left", app.left - 3, app.left + 4],
      ["sidebar", sidebar.right + 3, sidebar.right - 4],
    ]) {
      assert.equal(await grabs(outside, away), true, `${label} from outside`);
      assert.equal(await grabs(over, away), false, `${label} over its pane`);
      assert.equal(await grabs(over, middle), true, `${label} at the tab`);
    }

    await press(page, app.right + 3, away);
    await moveTo(page, 1800, away);
    near((await box(page, "#app")).right, 1800, "the edge grabbed off the tab");
    await page.mouse.up();

    await press(page, 1798, middle);
    await moveTo(page, 1990, middle);
    await fullIs(page, true);
    // During a drag the whole strip shows, for the line's full height.
    assert.equal(await grabs(wide.width - 1, away), true, "the blue line");
    await page.mouse.up();
    for (const x of [5, wide.width - 5]) {
      assert.equal(await grabs(x, away), false, `${x} away from the tab`);
      assert.equal(await grabs(x, middle), true, `${x} at the tab`);
    }
    await drag(page, 5, 300);
    near((await box(page, "#app")).left, 300, "the edge dragged back");
  });

  test(`in ${browser}, with the sidebar closed, text fills the column before and after a drag`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    await page.locator("#sidebar-toggle").click();
    assert.equal((await box(page, "#words")).width, 1046);
    await drag(page, (await box(page, "#app")).right, 1900);
    assert.equal((await box(page, "#app")).width, 1800);
    assert.equal((await box(page, "#words")).width, 1800 - 2 - 112);
  });

  test(`in ${browser}, on a wide page Agreed's cards, Work, Review, a decision and a thread fill the column, and a width: 100% image stops at 1200px`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page, session, url } = s;
    const started = await session.request(`${session.base}/api/threads`, {
      id: crypto.randomUUID(),
      round: "1",
      text: "Does this follow the column?",
      topic: "blocks",
      anchor: "Words",
      target: "words",
    });
    assert.equal(started.code, 201, JSON.stringify(started.body));

    // The column is the page's width less its borders, the sidebar and the
    // column's 56px padding on each side.
    const column = async () => (await box(page, "#app")).width - 2 - 224 - 112;
    // A thread starts 22px in from the text and ends where the text ends, at
    // 1160px and after a drag.
    await page.locator("pair-thread").waitFor();
    for (const at of [null, 1900]) {
      if (at) await drag(page, (await box(page, "#app")).right, at);
      const [thread, words, decision] = await Promise.all(
        ["pair-thread", "#words", "#page-content .decision"].map((selector) =>
          box(page, selector),
        ),
      );
      assert.equal(words.width, await column(), `text at ${at}`);
      assert.equal(decision.width, await column(), `the decision at ${at}`);
      assert.equal(thread.right, words.right, `the thread at ${at}`);
    }
    assert.equal((await box(page, "#page-content img")).width, 1200);

    for (const [hash, view] of [
      ["agreed", "#page-content .agreement-card"],
      ["work", "#work-view"],
      ["feedback", "#review-view"],
    ]) {
      await page.goto(url(`#${hash}`));
      await page.reload();
      await page.locator(view).first().waitFor();
      assert.equal((await box(page, "#app")).width, 1800);
      assert.equal((await box(page, view)).width, await column(), view);
    }
  });

  test(`in ${browser}, on a long page the block on screen stays within 23px through a drag`, async (t) => {
    const s = await setup(t, engine, { at: "long" });
    if (!s) return;
    const { page } = s;
    await page.locator("#words-20").evaluate((element) => {
      element.scrollIntoView({ block: "center", behavior: "instant" });
    });
    const { top } = await box(page, "#words-20");
    await press(page, (await box(page, "#app")).right);
    for (const x of [1500, 1600, 1700, 1800, 1900]) {
      await moveTo(page, x);
      const now = await box(page, "#words-20");
      assert.ok(Math.abs(now.top - top) <= 23, `${now.top} against ${top}`);
    }
    await page.mouse.up();
  });

  test(`in ${browser}, the search window's frame and a preview have no grips, and a read-only round has grips`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page, url } = s;
    // The search window is narrower than 1160px, so each frame opens as a whole
    // window here, where only the frame's mode can hide the grips.
    for (const address of ["embed/latest#blocks", "preview/1#blocks"]) {
      await page.goto(url(address));
      // The frame sets the mode once it loads, and the search window's frame
      // once it has the session's status.
      await page.waitForFunction(
        () => {
          const root = document.documentElement;
          return "embed" in root.dataset || root.dataset.mode === "preview";
        },
        undefined,
        { timeout: 5000 },
      );
      for (const side of ["left", "right", "side"])
        assert.equal(
          await page.locator(`.grip.${side}`).isVisible(),
          false,
          `${address} ${side}`,
        );
    }
    await page.goto(url("r/1#blocks"));
    await page.locator('#page-content[data-page-id="blocks"]').waitFor();
    assert.equal(await page.locator(".grip.left").isVisible(), true);
  });

  test(`in ${browser}, a session with nothing published has grips that set the width`, async (t) => {
    const h = await hub(t);
    const session = await h.session();
    const page = await open(t, "about:blank", { engine, viewport: wide });
    if (!page) return;
    await page.goto(`${h.server.origin}${session.base}/`);
    await page.locator(".grip.right").waitFor();
    await drag(page, (await box(page, "#app")).right, 1800);
    assert.equal((await box(page, "#app")).width, 1600);
    assert.equal(await saved(page, PAGE_KEY), "1600");
  });
}
