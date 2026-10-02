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
  ...planData("1", undefined, name),
  pages: [
    { id: "overview", title: "Overview", html: "<p>The first page.</p>" },
    { id: "quick", title: "Quick", html: "<p>A page with no figures.</p>" },
    { id: "slow", title: "Slow", html: '<div data-slow="1000">slow</div>' },
    { id: "later", title: "Later", html: '<div data-slow="1000">later</div>' },
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

test("a page load into a slow page keeps the previous page until it is complete", async (t) => {
  const s = await setup(t);
  if (!s) return;
  const other = await s.h.session();
  assert.equal((await other.publish(round("other"))).code, 200);
  // Each frame of the new document records whether the browser still shows
  // the previous page's header and column, and whether the page is drawing.
  await s.page.addInitScript(() => {
    window.moveFrames = [];
    const sample = () => {
      const running = (name) =>
        document
          .getAnimations()
          .some(
            (animation) =>
              animation.effect?.pseudoElement === name &&
              animation.playState === "running",
          );
      window.moveFrames.push({
        chrome: running("::view-transition-new(root)"),
        column: running("::view-transition-old(reading)"),
        drawing:
          document
            .getElementById("page-content")
            ?.hasAttribute("data-drawing") ?? true,
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
  await s.page.waitForTimeout(1200);
  const frames = await s.page.evaluate(() => window.moveFrames);
  const drawing = frames.filter((frame) => frame.drawing);
  // The previous column stays over the new page while it draws, and the
  // previous header gives way before the page is complete.
  assert.ok(drawing.some((frame) => frame.column));
  assert.ok(drawing.some((frame) => frame.column && !frame.chrome));
  assert.equal(frames.at(-1).column, false);
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
