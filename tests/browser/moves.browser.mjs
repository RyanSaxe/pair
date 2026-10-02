import assert from "node:assert/strict";
import crypto from "node:crypto";
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

// Each frame of the document a page load opens records what the browser
// shows: while its view transition runs, the new header and sidebar
// (chrome) and the previous page's column, and whether the new page is
// complete. Once the transition ends, both are the new page's.
function recordLoad(target) {
  window.moveFrames = [];
  const sample = () => {
    const shown = (pseudo) =>
      Number(getComputedStyle(document.documentElement, pseudo).opacity) > 0;
    const content = document.getElementById("page-content");
    const running = Boolean(document.activeViewTransition);
    if (running || window.moveFrames.length)
      window.moveFrames.push({
        chrome: !running || shown("::view-transition-new(root)"),
        column: running && shown("::view-transition-old(reading)"),
        // The 1 s crossfade from the previous column, after a wait long
        // enough to show the bar.
        fading: document
          .getAnimations()
          .some(
            (animation) =>
              animation.effect?.pseudoElement ===
                "::view-transition-old(reading)" &&
              animation.effect.getTiming().duration === 1000 &&
              animation.playState === "running",
          ),
        complete:
          content?.dataset.pageId === target &&
          !content.hasAttribute("data-drawing") &&
          !content.querySelector(".pending-page"),
      });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}
async function loadInto(t, pages, target, only) {
  const s = await setup(t);
  if (!s) return null;
  const other = await s.h.session();
  const data = { ...planData("1", undefined, "other"), pages };
  assert.equal((await other.publish(data, { only })).code, 200);
  await s.page.addInitScript(recordLoad, target);
  await s.page.evaluate((href) => {
    const link = document.createElement("a");
    link.id = "away";
    link.href = href;
    link.textContent = "away";
    document.body.append(link);
  }, `${s.h.server.origin}${other.base}/#${target}`);
  await s.page.locator("#away").click();
  await complete(s.page, target);
  await s.page.waitForTimeout(400);
  return s.page.evaluate(() => window.moveFrames);
}
// The previous column goes only with a complete page.
function assertHeld(frames) {
  assert.ok(frames.length > 0, "the page load ran no view transition");
  for (const frame of frames)
    if (!frame.column) assert.ok(frame.complete, JSON.stringify(frame));
}
// Frames with the new header and sidebar next to the previous column, other
// than the crossfade a slow page ends with. On a slow machine a page meant
// to be quick can take long enough for the bar and the crossfade.
const mixed = (frames) =>
  frames.filter((frame) => frame.chrome && frame.column && !frame.fading);

test("a page load into a complete page swaps the header, sidebar and page in one frame", async (t) => {
  const frames = await loadInto(
    t,
    [{ id: "quick", title: "Quick", html: "<p>Complete at once.</p>" }],
    "quick",
  );
  if (!frames) return;
  assertHeld(frames);
  assert.deepEqual(mixed(frames), []);
});

test("a page load into a page the served round does not carry yet keeps the previous page until it loads", async (t) => {
  // A page published after Agreed is not in the round the hub serves until
  // the round completes, so the new page fetches it.
  const frames = await loadInto(
    t,
    [
      {
        id: "ready",
        title: "Ready",
        html: '<p>Published.</p><div data-slow="300">figure</div>',
      },
      { id: "queued", title: "Queued", html: "<p>Not yet.</p>" },
    ],
    "ready",
    ["ready"],
  );
  if (!frames) return;
  assertHeld(frames);
});

test("a page load into a slow page shows the new header with the bar and keeps the previous column", async (t) => {
  const frames = await loadInto(
    t,
    [{ id: "slow", title: "Slow", html: '<div data-slow="1000">slow</div>' }],
    "slow",
  );
  if (!frames) return;
  assertHeld(frames);
  // The column waits for the page under the new header and the bar.
  assert.ok(mixed(frames).some((frame) => !frame.complete));
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

test("a bell entry that opens another session leaves the list on screen until the new page replaces it", async (t) => {
  const s = await setup(t);
  if (!s) return;
  const other = await s.h.session();
  assert.equal((await other.publish(round("other"))).code, 200);
  const id = crypto.randomUUID();
  const started = await other.request(`${other.base}/api/threads`, {
    id,
    round: "1",
    topic: "quick",
    anchor: "A page with no figures",
    target: "page-content",
    text: "Where does this land?",
  });
  assert.equal(started.code, 201, JSON.stringify(started.body));
  // Each document notes, as it unloads, whether the bell's list was open.
  await s.page.addInitScript(() =>
    addEventListener("pagehide", () =>
      sessionStorage.setItem(
        "bell-open",
        String(document.getElementById("center-pop").matches(":popover-open")),
      ),
    ),
  );
  await s.page.reload();
  await s.page.locator("#bell").waitFor();
  assert.equal(
    (await other.action("reply", { note: id, text: "Here." })).code,
    200,
  );
  await s.page.locator("#bell").click();
  await s.page.locator("#center-list .session-row").click();
  await s.page.waitForURL(new RegExp(other.base));
  assert.equal(
    await s.page.evaluate(() => sessionStorage.getItem("bell-open")),
    "true",
  );
});
