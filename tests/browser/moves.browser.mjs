import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// A page is complete once its components have drawn, so a component whose
// setup settles after data-slow milliseconds makes a page that slow. Every
// document registers it as the frame creates planUI, before the first page
// renders, through the page API planUI.define.
function slowComponent() {
  let ui;
  Object.defineProperty(window, "planUI", {
    configurable: true,
    get: () => ui,
    set(value) {
      ui = value;
      value.define("slow", {
        match: "[data-slow]",
        setup: (element) =>
          new Promise((resolve) =>
            setTimeout(resolve, Number(element.dataset.slow)),
          ),
      });
    },
  });
}
const round = (name) => ({
  ...planData("1", name),
  pages: [
    { id: "overview", title: "Overview", html: "<p>The first page.</p>" },
    { id: "quick", title: "Quick", html: "<p>A page with no figures.</p>" },
    { id: "slow", title: "Slow", html: '<div data-slow="1000">slow</div>' },
    { id: "later", title: "Later", html: '<div data-slow="1000">later</div>' },
    {
      id: "long",
      title: "Long",
      html: '<div data-slow="1000">long</div>' + "<p>Text.</p>".repeat(120),
    },
  ],
});
async function setup(t, pageOptions) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(round("example"))).code, 200);
  const page = await open(t, "about:blank", pageOptions);
  if (!page) return null;
  await page.addInitScript(slowComponent);
  await page.goto(`${h.server.origin}${session.base}/#overview`);
  await page.locator("#bell").waitFor();
  return { h, page };
}
const pageLink = (page, id) => page.locator(`#page-list [data-page="${id}"]`);
const complete = (page, id) =>
  page.waitForFunction(
    (wanted) => {
      const content = document.getElementById("page-content");
      return (
        content.dataset.pageId === wanted &&
        !content.hasAttribute("data-drawing")
      );
    },
    id,
    { timeout: 5000 },
  );
// The previous page's picture is the inert, fixed copy of the column.
const picture = (page) =>
  page.evaluate(() =>
    [...document.body.children].some(
      (element) => element.inert && element.style.position === "fixed",
    ),
  );
const barAnimations = (page) =>
  page.evaluate(() =>
    document
      .querySelector(".move-bar")
      .getAnimations()
      .map((animation) => ({
        delay: animation.effect.getTiming().delay,
        duration: animation.effect.getTiming().duration,
      })),
  );

// Whether any part of the bar is on screen: inside the window and inside
// every ancestor that clips its overflow.
const barOnScreen = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector(".move-bar");
    if (Number(getComputedStyle(bar).opacity) === 0) return false;
    let { top, bottom, left, right } = bar.getBoundingClientRect();
    top = Math.max(top, 0);
    bottom = Math.min(bottom, innerHeight);
    for (let box = bar.parentElement; box; box = box.parentElement) {
      if (getComputedStyle(box).overflow === "visible") continue;
      const clip = box.getBoundingClientRect();
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    return bottom > top && right > left;
  });

test("a move to a page that is complete at once swaps it in with no bar", async (t) => {
  const s = await setup(t);
  if (!s) return;
  await pageLink(s.page, "quick").click();
  await complete(s.page, "quick");
  assert.equal(await picture(s.page), false);
  await s.page.waitForTimeout(300);
  assert.deepEqual(await barAnimations(s.page), []);
});

test("a slow move keeps the previous page, shows the bar after 200 ms, then crossfades", async (t) => {
  const s = await setup(t);
  if (!s) return;
  await pageLink(s.page, "slow").click();
  assert.equal(await picture(s.page), true);
  const [growing] = await barAnimations(s.page);
  assert.ok(growing.delay > 150 && growing.delay <= 200, `${growing.delay}`);
  assert.equal(growing.duration, 2700);
  await complete(s.page, "slow");
  const fading = await s.page.evaluate(() =>
    document
      .getElementById("page-content")
      .getAnimations()
      .map((animation) => animation.effect.getTiming().duration),
  );
  assert.deepEqual(fading, [1000]);
  assert.deepEqual(
    (await barAnimations(s.page)).map((animation) => animation.duration),
    [1000],
  );
  await s.page.waitForTimeout(1200);
  assert.equal(await picture(s.page), false);
});

test("a second click during a move keeps one bar and never shows the page clicked past", async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.page.evaluate(() => {
    window.shown = [];
    const content = document.getElementById("page-content");
    new MutationObserver(() => {
      if (!content.hasAttribute("data-drawing"))
        window.shown.push(content.dataset.pageId);
    }).observe(content, { attributes: true });
  });
  await pageLink(s.page, "slow").click();
  await s.page.waitForTimeout(100);
  await pageLink(s.page, "later").click();
  assert.equal((await barAnimations(s.page)).length, 1);
  await complete(s.page, "later");
  assert.ok(!(await s.page.evaluate(() => window.shown)).includes("slow"));
});

test("a page load into a slow page runs no view transition and shows the bar", async (t) => {
  const s = await setup(t);
  if (!s) return;
  const other = await s.h.session();
  assert.equal((await other.publish(round("other"))).code, 200);
  // A view transition across page loads showed a blank white frame in some
  // Chrome setups, so each frame of the new document records whether one
  // runs, and whether the bar is on screen.
  await s.page.addInitScript(() => {
    window.moveFrames = [];
    const sample = () => {
      const bar = document.querySelector(".move-bar");
      window.moveFrames.push({
        transition: Boolean(document.activeViewTransition),
        bar: bar ? Number(getComputedStyle(bar).opacity) > 0 : false,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await s.page.evaluate((href) => {
    const link = document.createElement("a");
    link.id = "away";
    link.href = href;
    link.textContent = "away";
    document.body.append(link);
  }, `${s.h.server.origin}${other.base}/#slow`);
  await s.page.locator("#away").click();
  await complete(s.page, "slow");
  const frames = await s.page.evaluate(() => window.moveFrames);
  assert.ok(frames.length > 0);
  assert.ok(!frames.some((frame) => frame.transition));
  assert.ok(frames.some((frame) => frame.bar));
});

test("with reduced motion a slow move shows the bar still and swaps in with no fade", async (t) => {
  const s = await setup(t, { reducedMotion: "reduce" });
  if (!s) return;
  await pageLink(s.page, "slow").click();
  await s.page.waitForTimeout(400);
  assert.equal(
    await s.page.evaluate(
      () => getComputedStyle(document.querySelector(".move-bar")).transform,
    ),
    "matrix(0.9, 0, 0, 1, 0, 0)",
  );
  await complete(s.page, "slow");
  assert.deepEqual(
    await s.page.evaluate(() =>
      document.getElementById("page-content").getAnimations(),
    ),
    [],
  );
});

// On a phone the page list is in a dialog, and the column scrolls inside
// .app-body, which clips anything outside it. A move back to a page returns
// to where the reader left it, so the page can be scrolled while it draws.
test("on a phone a slow move shows the bar under the header, even onto a page scrolled down", async (t) => {
  const s = await setup(t, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  if (!s) return;
  await pageLink(s.page, "long").dispatchEvent("click");
  await complete(s.page, "long");
  await s.page.evaluate(() =>
    document.querySelector(".app-body").scrollTo(0, 2000),
  );
  await pageLink(s.page, "quick").dispatchEvent("click");
  await complete(s.page, "quick");
  await pageLink(s.page, "long").dispatchEvent("click");
  await s.page.waitForTimeout(400);
  assert.equal(await barOnScreen(s.page), true);
});
