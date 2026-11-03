import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

const PAGE_KEY = "pair:page-width";
const SIDEBAR_KEY = "pair:sidebar-width";
const wide = { width: 2000, height: 900 };

const prose =
  "The hub serves every live session from one Node process and stores each session on disk, so a change to the width of this paragraph would break its lines in other places. ".repeat(
    3,
  );
const shiki = `export async function codeToHtml(source) {
  return "<pre class='shiki'><code>" + source.replace(/</g, "&lt;") + "</code></pre>";
}`;
const code = (name) =>
  `<pre data-language="js" data-file="${name}.js">const retries = 3;\nconst delay = 8;</pre>`;
// This image is much wider than any column in these tests.
const image = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="300"/>',
)}`;
const pages = [
  {
    id: "blocks",
    title: "Blocks",
    html: `<p id="words">${prose}</p>${code("blocks")}
<div data-prototype="probe"></div>
<figure><img src="${image}" alt="A wide image" style="width: 100%"></figure>`,
    prototypes: [
      {
        id: "probe",
        title: "Probe",
        height: 120,
        html: "<!doctype html><title>Probe</title><p>Probe</p>",
      },
    ],
  },
  {
    id: "long",
    title: "Long",
    html: Array.from(
      { length: 40 },
      (_, index) => `<p id="words-${index}">${prose}</p>${code(index)}`,
    ).join(""),
  },
];

async function setup(t, engine, { viewport = wide, at = "blocks" } = {}) {
  const h = await hub(t);
  const session = await h.session();
  const published = await session.publish({ ...planData(), pages });
  assert.equal(published.code, 200, published.body.error);
  const url = (rest) => `${h.server.origin}${session.base}/${rest}`;
  const page = await open(t, "about:blank", { engine, viewport });
  if (!page) return null;
  await page.route(/esm\.sh\/shiki/, (route) =>
    route.fulfill({ body: shiki, contentType: "text/javascript" }),
  );
  await page.goto(url(`#${at}`));
  await page.locator(`#page-content[data-page-id="${at}"]`).waitFor();
  return { h, session, page, url };
}

const box = (page, selector) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const { left, right, width, top } = element.getBoundingClientRect();
      return { left, right, width, top };
    });
const saved = (page, key) =>
  page.evaluate((key) => localStorage.getItem(key), key);
// The browser fires resize at its next frame, so this waits for the attribute.
const fullIs = (page, expected) =>
  page.waitForFunction(
    (expected) =>
      document.documentElement.hasAttribute("data-page-full") === expected,
    expected,
    { timeout: 3000 },
  );
const save = (page, values) =>
  page.evaluate((values) => {
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(key, value);
  }, values);

// A tab sits at its strip's left plus the ::after's own left.
const tab = (page, side) =>
  page.locator(`.grip.${side}`).evaluate((grip) => {
    const strip = grip.getBoundingClientRect().left;
    const { left, width } = getComputedStyle(grip, "::after");
    const start = strip + parseFloat(left);
    return { left: start, right: start + parseFloat(width) };
  });
const blueLine = (page, side) =>
  page.locator(`.grip.${side}`).evaluate((grip) => {
    const strip = grip.getBoundingClientRect().left;
    return strip + parseFloat(getComputedStyle(grip, "::before").left);
  });

const Y = 450;
async function press(page, x, y = Y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
}
const moveTo = (page, x, y = Y) => page.mouse.move(x, y, { steps: 8 });
async function drag(page, from, to) {
  await press(page, from);
  await moveTo(page, to);
  await page.mouse.up();
}
const near = (actual, expected, label = "") =>
  assert.ok(
    Math.abs(actual - expected) <= 1,
    `${label} at ${actual}, expected ${expected}`,
  );

const engines = { Chrome: "chrome", WebKit: "webkit" };
for (const [browser, engine] of Object.entries(engines)) {
  test(`in ${browser}, dragging either page edge moves both, the grabbed edge follows the pointer, text keeps its width and blocks widen`, async (t) => {
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
    assert.equal(after.words, before.words);
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

  test(`in ${browser}, with the sidebar closed, text is 1046px before and after a drag`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page } = s;
    await page.locator("#sidebar-toggle").click();
    assert.equal((await box(page, "#words")).width, 1046);
    await drag(page, (await box(page, "#app")).right, 1900);
    assert.equal((await box(page, "#app")).width, 1800);
    assert.equal((await box(page, "#words")).width, 1046);
  });

  test(`in ${browser}, on a wide page Agreed, Work, Review and a thread stay at text width, and a width: 100% image stops at 1200px`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page, session, url } = s;
    const started = await session.request(`${session.base}/api/threads`, {
      id: crypto.randomUUID(),
      round: "1",
      text: "Does this stay at text width?",
      topic: "blocks",
      anchor: "Words",
      target: "words",
    });
    assert.equal(started.code, 201, JSON.stringify(started.body));

    await page.locator("pair-thread").waitFor();
    const thread = await box(page, "pair-thread");
    await drag(page, (await box(page, "#app")).right, 1900);
    assert.equal((await box(page, "#page-content img")).width, 1200);
    const widened = await box(page, "pair-thread");
    assert.equal(widened.width, thread.width, "the thread keeps its width");
    assert.equal(widened.right, (await box(page, "#words")).right);

    for (const [hash, view] of [
      ["agreed", "#page-content .agreement-card"],
      ["work", "#work-view"],
      ["feedback", "#review-view"],
    ]) {
      await page.goto(url(`#${hash}`));
      await page.reload();
      await page.locator(view).first().waitFor();
      assert.equal((await box(page, "#app")).width, 1800);
      assert.equal((await box(page, view)).width, 822, view);
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

  test(`in ${browser}, the search window's frame and a preview have no grips and no text limit, and a read-only round has grips`, async (t) => {
    const s = await setup(t, engine);
    if (!s) return;
    const { page, url } = s;
    // The search window is narrower than 1160px, so each frame opens as a whole
    // window here, where only the frame's mode can hide the grips.
    for (const address of ["embed/latest#blocks", "preview/1#blocks"]) {
      await page.goto(url(address));
      // The frame sets the mode once it loads, and the search window's frame
      // once it has the session's status. Text wider than 1046px has no limit.
      await page.waitForFunction(
        () => document.getElementById("words")?.offsetWidth > 1046,
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
