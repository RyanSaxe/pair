import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// WebKit rounds a scroll position to whole pixels in its own way, so a
// landing it holds can sit one pixel from where the reader left. A real
// miss is tens or hundreds of pixels.
const nearly = (actual, expected) =>
  assert.ok(
    Math.abs(actual - expected) <= 1,
    `landed at ${actual}, expected ${expected}`,
  );

// Where a page lands for each way of arriving at it, while the code blocks
// above the place grow after the page lands, in Chrome and in WebKit, the
// engine of every browser on an iPhone.
//
// The stand-in for Shiki highlights a block only once the test opens a
// gate, and adds 160px of padding under each block it highlights. Shiki
// keeps a block's height, so the padding stands for any part of a page above
// the place that changes height after the page shows, such as a screenshot
// that loads or a block whose highlighting fails.
const shiki = `const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export async function codeToHtml(source) {
  await window.highlightGate.opened;
  const lines = source.split("\\n").map((line) =>
    '<span class="line">' + escape(line) + "</span>");
  return '<pre class="shiki" style="padding-bottom: 160px"><code>' +
    lines.join("\\n") + "</code></pre>";
}`;
// Runs in every document before the frame. close() makes the next
// highlighting wait for the next open().
const gate = () => {
  window.highlightGate = {
    close() {
      this.opened = new Promise((resolve) => (this.open = resolve));
    },
  };
  window.highlightGate.close();
};

const code = (n) =>
  `<pre data-language="js" data-file="step-${n}.js">${Array.from(
    { length: 24 },
    (_, line) => `const step${n}line${line} = run(${n}, ${line});`,
  ).join("\n")}</pre>`;
// The Code page has four code blocks and a screenshot above the result
// line and filler below it, so the result can sit in the middle of the
// window.
const round = () => ({
  ...planData(),
  pages: [
    planData().pages[0],
    {
      id: "code",
      title: "Code",
      html: `${[1, 2, 3, 4].map(code).join("")}<figure><img src="http://images.localhost/1.svg" width="370" alt="Screenshot"><figcaption>Screenshot.</figcaption></figure><p id="result">Preserve one result per input.</p>${"<p>Filler paragraph.</p>".repeat(40)}`,
    },
  ],
});

const widths = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

async function setup(t, engine, viewport) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(round())).code, 200);
  const url = (rest) => `${h.server.origin}${session.base}/${rest}`;
  const page = await open(t, "about:blank", { engine, viewport });
  if (!page) return null;
  await page.addInitScript(gate);
  await page.route(/esm\.sh\/shiki/, (route) =>
    route.fulfill({ body: shiki, contentType: "text/javascript" }),
  );
  // The screenshot loads at once, or once the test releases it after
  // holdScreenshot().
  let screenshot = Promise.resolve();
  let releaseScreenshot = () => {};
  const holdScreenshot = () =>
    (screenshot = new Promise((resolve) => (releaseScreenshot = resolve)));
  await page.route(/^http:\/\/images\.localhost\//, async (route) => {
    await screenshot;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="370" height="400"/>',
    });
  });
  const thread = async () => {
    const id = crypto.randomUUID();
    const started = await session.request(`${session.base}/api/threads`, {
      id,
      round: "1",
      text: "Where does this land?",
      topic: "code",
      anchor: "Result line",
      target: "result",
    });
    assert.equal(started.code, 201, JSON.stringify(started.body));
    return id;
  };
  const reply = async (id) =>
    assert.equal(
      (await session.action("reply", { note: id, text: "Here." })).code,
      200,
    );
  return {
    page,
    url,
    thread,
    reply,
    holdScreenshot,
    releaseScreenshot: () => releaseScreenshot(),
  };
}

// A task and two frames, by which a scroll, a resize and its observers have
// run.
const frames = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  );
// Opens the gate, waits until every block is highlighted and has its new
// height, and returns the element's place in the window.
async function grow(page, selector) {
  await page.evaluate(() => window.highlightGate.open());
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#page-content .shiki").length === 4 &&
      document.querySelector("#page-content").dataset.pageId === "code",
  );
  await frames(page);
  return place(page, selector);
}
const place = (page, selector) =>
  page.locator(selector).evaluate((element) => ({
    top: Math.round(element.getBoundingClientRect().top),
    bottom: Math.round(element.getBoundingClientRect().bottom),
    header: Math.round(
      document.getElementById("frame-header").getBoundingClientRect().bottom,
    ),
    window: innerHeight,
  }));
const inView = (at) =>
  assert.ok(at.top >= at.header && at.bottom <= at.window, JSON.stringify(at));
const focused = (page, id) =>
  page.waitForFunction((target) => document.activeElement?.id === target, id, {
    timeout: 5000,
  });
const title = (page, text) =>
  page.locator("#page-title", { hasText: text }).waitFor({ timeout: 5000 });
// Scrolls so the result line's top is 300px below the window's top, and
// returns its place once the frame has saved it.
async function readTo(page) {
  await page.evaluate(() => {
    const box = [
      document.querySelector("main"),
      document.querySelector(".app-body"),
    ].find((el) => /auto|scroll/.test(getComputedStyle(el).overflowY));
    const result = document.getElementById("result");
    box.scrollBy(0, result.getBoundingClientRect().top - 300);
  });
  // The frame saves the place 250ms after the last scroll.
  await page.waitForTimeout(400);
  return place(page, "#result");
}
// Opens a page from the sidebar, as the reader does.
const openPage = (page, id) =>
  page.locator(`#page-list [data-page="${id}"]`).dispatchEvent("click");

const engines = { Chrome: "chrome", WebKit: "webkit" };
for (const [browser, engine] of Object.entries(engines))
  for (const [width, viewport] of Object.entries(widths)) {
    test(`in ${browser} on ${width}, a reply's notification opened from another page lands on the reply while code above it grows`, async (t) => {
      const s = await setup(t, engine, viewport);
      if (!s) return;
      const id = await s.thread();
      await s.reply(id);
      await s.page.goto(s.url("#overview"));
      await title(s.page, "Overview");
      await s.page.goto(s.url(`?target=thread-${id}-1#code`));
      await focused(s.page, `thread-${id}-1`);
      inView(await grow(s.page, `#thread-${id}-1`));
    });

    test(`in ${browser} on ${width}, a reply opened from the bell on another page lands on the reply while code above it grows`, async (t) => {
      const s = await setup(t, engine, viewport);
      if (!s) return;
      const id = await s.thread();
      await s.page.goto(s.url("#overview"));
      // The bell marks every event it finds on its first load as seen, so the
      // agent replies once the bell shows.
      await s.page.locator("#bell").waitFor();
      await s.reply(id);
      await s.page.locator("#bell").click();
      await s.page.locator("#center-list .session-row").click();
      await focused(s.page, `thread-${id}-1`);
      inView(await grow(s.page, `#thread-${id}-1`));
    });

    test(`in ${browser} on ${width}, a link to a block opened from another page lands on the block while code above it grows`, async (t) => {
      const s = await setup(t, engine, viewport);
      if (!s) return;
      await s.page.goto(s.url("#overview"));
      await title(s.page, "Overview");
      await s.page.goto(s.url("?target=result#code"));
      await focused(s.page, "result");
      inView(await grow(s.page, "#result"));
    });

    test(`in ${browser} on ${width}, coming back to a page lands where the reader left it while code above it grows`, async (t) => {
      const s = await setup(t, engine, viewport);
      if (!s) return;
      await s.page.goto(s.url("#code"));
      await title(s.page, "Code");
      await grow(s.page, "#result");
      const left = await readTo(s.page);
      await s.page.evaluate(() => window.highlightGate.close());
      await openPage(s.page, "overview");
      await title(s.page, "Overview");
      await openPage(s.page, "code");
      await title(s.page, "Code");
      await frames(s.page);
      nearly((await grow(s.page, "#result")).top, left.top);
    });

    test(`in ${browser} on ${width}, a reload lands where the reader was while code above it grows`, async (t) => {
      const s = await setup(t, engine, viewport);
      if (!s) return;
      await s.page.goto(s.url("#code"));
      await title(s.page, "Code");
      await grow(s.page, "#result");
      const left = await readTo(s.page);
      await s.page.reload();
      await title(s.page, "Code");
      await frames(s.page);
      nearly((await grow(s.page, "#result")).top, left.top);
    });

    test(`in ${browser} on ${width}, a reload lands where the reader was while a screenshot above it loads more than a second later`, async (t) => {
      const s = await setup(t, engine, viewport);
      if (!s) return;
      await s.page.goto(s.url("#code"));
      await title(s.page, "Code");
      await grow(s.page, "#result");
      await s.page
        .locator("#page-content img")
        .evaluate((image) => image.decode());
      const left = await readTo(s.page);
      s.holdScreenshot();
      // The load event waits for the screenshot.
      await s.page.reload({ waitUntil: "domcontentloaded" });
      await title(s.page, "Code");
      await grow(s.page, "#result");
      // A landing stops holding its place after a second with no change.
      await s.page.waitForTimeout(1500);
      s.releaseScreenshot();
      await s.page
        .locator("#page-content img")
        .evaluate((image) => image.decode());
      await frames(s.page);
      nearly((await place(s.page, "#result")).top, left.top);
    });
  }
