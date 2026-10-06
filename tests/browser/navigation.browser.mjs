import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep } from "../support/hub.mjs";

// A round whose Overview has a block a page thread can target, with the
// filler above and below it.
const round = (number, filler = "") => ({
  ...planData(number),
  pages: [
    {
      id: "overview",
      title: "Overview",
      html: `${filler}<p id="result">Preserve one result per input.</p>${filler}`,
    },
  ],
});
const kinds = {
  page: { topic: "overview", anchor: "Result line", target: "result" },
  progress: { topic: "agreed", anchor: "Progress", target: "agent-activity" },
  overall: { topic: "overall", anchor: "Overall feedback" },
};

async function setup(t) {
  const h = await hub(t);
  const session = await h.session();
  const url = (rest) => `${h.server.origin}${session.base}/${rest}`;
  const publish = async (number, filler) =>
    assert.equal((await session.publish(round(number, filler))).code, 200);
  // The agent reads each submission, as it would before the next round.
  const send = async (number) => {
    const sent = await session.feedback(session.event("feedback-only", number));
    assert.equal(sent.code, 200, JSON.stringify(sent.body));
    assert.equal((await session.action("read")).code, 200);
  };
  const thread = async (number, kind) => {
    const id = crypto.randomUUID();
    const started = await session.request(`${session.base}/api/threads`, {
      id,
      round: number,
      text: "Where does this land?",
      ...kinds[kind],
    });
    assert.equal(started.code, 201, JSON.stringify(started.body));
    return id;
  };
  // The agent's first reply is the thread's row 1. With as set to "html",
  // text is the reply's markup.
  const reply = async (id, text = "Here.", as = "text") =>
    assert.equal(
      (await session.action("reply", { note: id, [as]: text })).code,
      200,
    );
  return { session, url, publish, send, thread, reply };
}

const focused = (page, id, row = 1) =>
  page.waitForFunction(
    (target) => document.activeElement?.id === target,
    `thread-${id}-${row}`,
    { timeout: 5000 },
  );
// Once a page loads, the browser scrolls to the element whose ID the
// address's # part names and focuses it, or clears focus when that element
// cannot take it. By a task and two frames after the load, it has.
const afterLoad = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  );
// The reply sits whole between the header and the bottom of the window.
async function inView(page, id, row = 1) {
  const place = await page
    .locator(`#thread-${id}-${row}`)
    .evaluate((reply) => ({
      top: reply.getBoundingClientRect().top,
      bottom: reply.getBoundingClientRect().bottom,
      header: document.getElementById("frame-header").getBoundingClientRect()
        .bottom,
      window: innerHeight,
    }));
  assert.ok(
    place.top >= place.header && place.bottom <= place.window,
    JSON.stringify(place),
  );
}
const selected = (page, tab) =>
  page.locator(`#${tab}-tab[aria-selected="true"]`).waitFor({ timeout: 5000 });
const cards = (page, id) =>
  page.locator(`pair-thread[data-thread="${id}"]`).count();
const title = (page, text) =>
  page.locator("#page-title", { hasText: text }).waitFor({ timeout: 5000 });
// The bell marks every event it finds on its first load as seen, so each
// test waits for the bell to show before the agent replies.
const bellReady = (page) => page.locator("#bell").waitFor();
async function bell(page) {
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").click();
}

test("a loaded session draws its header from the answers in its page", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const page = await open(t, "about:blank");
  if (!page) return;
  const asked = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));
  await page.goto(s.url(""));
  // The bell shows once the first status and session list are drawn. The
  // frame asks the hub for either only if the page did not carry it.
  await bellReady(page);
  assert.deepEqual(
    asked.filter((path) => /\/api\/(status|sessions)$/.test(path)),
    [],
  );
});

test("a Progress reply's link opens its card and focuses the reply", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const id = await s.thread("1", "progress");
  await s.reply(id);
  const page = await open(t, s.url(`?target=thread-${id}-1#agreed`));
  if (!page) return;
  await focused(page, id);
  const card = page.locator(`pair-thread[data-thread="${id}"]`);
  assert.equal(await card.getAttribute("collapsed"), null);
});

// The bell links a reply on the overall comment to the thread's page,
// overall, and the thread's card is at the end of Review.
test("an overall reply's link opens Review with the thread at its end and focuses the reply, and so does the bell from another page", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const id = await s.thread("1", "overall");
  await s.reply(id);
  const page = await open(t, s.url(`?target=thread-${id}-1#overall`));
  if (!page) return;
  await page
    .locator(`#overall-threads > pair-thread[data-thread="${id}"]`)
    .waitFor();
  await page.locator("#feedback-title", { hasText: "Review" }).waitFor();
  await focused(page, id);
  await page.locator('#page-list [data-page="agreed"]').click();
  await title(page, "Agreed so far");
  await s.reply(id, "Here again.");
  await bell(page);
  await focused(page, id, 2);
});

// A reply's link names the reply's page, and the page can give one of its
// own elements the page's ID.
test("a reply's link keeps the reply focused after the page loads when an element of its page has the page's ID", async (t) => {
  const s = await setup(t);
  const published = await s.session.publish({
    ...planData("1"),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: '<h2 id="overview">Overview</h2><p id="result">Preserve one result per input.</p>',
      },
    ],
  });
  assert.equal(published.code, 200);
  const id = await s.thread("1", "page");
  await s.reply(id);
  const page = await open(t, s.url(`?target=thread-${id}-1#overview`));
  if (!page) return;
  await focused(page, id);
  await afterLoad(page);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    `thread-${id}-1`,
  );
});

test("a reply in the round just sent opens under Last round", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const onPage = await s.thread("1", "page");
  const onProgress = await s.thread("1", "progress");
  await s.send("1");
  const page = await open(t, s.url("#agreed"));
  if (!page) return;
  await bellReady(page);
  await s.reply(onPage);
  await bell(page);
  await selected(page, "past");
  await page.locator("#past-tab", { hasText: "Last round" }).waitFor();
  await title(page, "Overview");
  await focused(page, onPage);
  await s.reply(onProgress);
  await page.goto(s.url(`?target=thread-${onProgress}-1#agreed`));
  await selected(page, "past");
  await title(page, "Agreed so far");
  await focused(page, onProgress);
});

test("a reply in an older round opens in the left tab as its round, not /r/", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const id = await s.thread("1", "page");
  await s.send("1");
  await s.publish("2");
  await s.send("2");
  const page = await open(t, s.url("#agreed"));
  if (!page) return;
  await bellReady(page);
  await s.reply(id);
  await bell(page);
  await selected(page, "past");
  await page.locator("#past-tab", { hasText: "Round 1" }).waitFor();
  await focused(page, id);
  assert.doesNotMatch(page.url(), /\/r\//);
});

test("a long reply opened from the bell lands whole between the header and the bottom of a phone's screen", async (t) => {
  const s = await setup(t);
  await s.publish("1", "<p>Filler paragraph.</p>".repeat(40));
  const id = await s.thread("1", "page");
  const page = await open(t, s.url("#agreed"), {
    viewport: { width: 390, height: 844 },
  });
  if (!page) return;
  await bellReady(page);
  // Uncut, the reply is several screens tall.
  await s.reply(id, "The retry runs once after a short wait. ".repeat(300));
  await bell(page);
  await focused(page, id);
  const reply = page.locator(`#thread-${id}-1`);
  await reply.locator(".thread-more").waitFor();
  await inView(page, id);
});

// Each screenshot loads only after the bell has scrolled to the reply it
// opens, and has no height until it loads. In the agent's earlier reply, the
// text under the screenshots cuts that reply to its usual height before they
// load. On the page, the screenshots above the thread are never cut.
const screenshot = (n) =>
  `<figure><img src="http://images.localhost/${n}.svg" width="370" alt="Screenshot ${n}"><figcaption>Screenshot ${n}.</figcaption></figure>`;
const shots = [1, 2, 3].map(screenshot).join("");
const words =
  "<p>The note dialog at 390px with the image button at the right end of the Feedback label row.</p>";
for (const [where, filler, earlier] of [
  ["an earlier reply", "", shots + words.repeat(6)],
  ["the page above the thread", shots + words, words],
])
  test(`a reply opened from the bell on a phone stays in view while screenshots in ${where} load`, async (t) => {
    const s = await setup(t);
    await s.publish("1", filler + "<p>Filler paragraph.</p>".repeat(40));
    const id = await s.thread("1", "page");
    await s.reply(id, earlier, "html");
    const page = await open(t, "about:blank", {
      viewport: { width: 390, height: 844 },
    });
    if (!page) return;
    let release;
    const released = new Promise((resolve) => (release = resolve));
    await page.route(/^http:\/\/images\.localhost\//, async (route) => {
      await released;
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="370" height="800"/>',
      });
    });
    await page.goto(s.url("#agreed"));
    await bellReady(page);
    await s.reply(id, "The retry runs once after a short wait. ".repeat(30));
    await bell(page);
    await focused(page, id, 2);
    release();
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete),
    );
    // A screenshot's height and the cut of its reply each take a frame.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await inView(page, id, 2);
  });

test("each Progress thread has one card, and none while Current waits", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const first = await s.thread("1", "progress");
  await s.reply(first);
  const page = await open(t, s.url("#agreed"));
  if (!page) return;
  await page.locator(`pair-thread[data-thread="${first}"]`).waitFor();
  const agreed = page.locator('#page-list [data-page="agreed"]');
  await agreed.click();
  await agreed.click();
  await page.keyboard.press("a");
  assert.equal(await cards(page, first), 1);
  await s.send("1");
  await page.reload();
  const second = await s.thread("1", "progress");
  await s.reply(second);
  // Two status polls.
  await sleep(3000);
  assert.equal(await cards(page, first), 0);
  assert.equal(await cards(page, second), 0);
  await page.locator("#past-tab").click();
  await agreed.click();
  await page.locator(`pair-thread[data-thread="${second}"]`).waitFor();
  assert.equal(await cards(page, first), 1);
  assert.equal(await cards(page, second), 1);
});

test("Back to current opens the waiting Agreed, not an empty Review", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const page = await open(t, s.url("#feedback"));
  if (!page) return;
  // The frame saves feedback as round 1's place.
  await page.locator("#review-view").waitFor();
  await s.send("1");
  const waiting = async () => {
    await page.locator("#reading").waitFor();
    assert.equal(await page.evaluate(() => location.hash), "#agreed");
    assert.equal(await page.locator("#review-view").isVisible(), false);
  };
  await page.goto(s.url("r/1"));
  await page.locator("#history-return").click();
  await page.waitForURL(/\/s\/[^/]+\/(#.*)?$/);
  await waiting();
  await page.goto(s.url("#feedback"));
  await waiting();
});

test("the left tab reads Last round for the round before Current's, and Round 1 once opened from the Rounds panel", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  await s.send("1");
  await s.publish("2");
  await s.send("2");
  await s.publish("3");
  const page = await open(t, s.url("#agreed"));
  if (!page) return;
  // The tab is enabled once the first status has loaded round 2.
  await page
    .locator("#past-tab:not([disabled])", { hasText: "Last round" })
    .waitFor();
  await page.locator("#round").click();
  await page.locator("#round-list button", { hasText: "Round 1" }).click();
  await selected(page, "past");
  await page.locator("#past-tab", { hasText: "Round 1" }).waitFor();
});

test("the sidebar opens and closes at 1280px, where it slides without drawing outside the frame, and at 375px, where it slides over the page", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const page = await open(t, s.url("#agreed"), {
    viewport: { width: 1280, height: 800 },
  });
  if (!page) return;
  const toggle = page.locator("#sidebar-toggle");
  const sidebar = page.locator("#sidebar");
  const expanded = async (value) =>
    assert.equal(await toggle.getAttribute("aria-expanded"), String(value));
  // Holds the sidebar's slide at its midpoint and reports what shows 10px
  // left of the frame, where a 1280px window has ground beside the frame.
  const leftOfFrameMidSlide = () =>
    page.evaluate(() => {
      const slides = document.getElementById("sidebar").getAnimations();
      const slide = slides.find(
        (item) => item.transitionProperty === "transform",
      );
      if (!slide) return "no slide";
      const midpoint = slide.effect.getComputedTiming().duration / 2;
      for (const item of slides) {
        item.pause();
        item.currentTime = midpoint;
      }
      const frame = document.getElementById("app").getBoundingClientRect();
      const hit = document.elementFromPoint(frame.left - 10, frame.top + 200);
      for (const item of slides) item.play();
      return hit?.closest("#sidebar") ? "sidebar" : "ground";
    });
  // Where the page column starts, from the frame's left edge.
  const columnAt = (left) =>
    page.waitForFunction(
      (expected) =>
        document.querySelector(".main-column").getBoundingClientRect().left -
          document.getElementById("app").getBoundingClientRect().left ===
        expected,
      left,
      { timeout: 5000 },
    );
  const border = 1;
  const width = 224;

  await sidebar.waitFor();
  await expanded(true);
  await columnAt(border + width);
  await toggle.click();
  assert.equal(await leftOfFrameMidSlide(), "ground");
  await sidebar.waitFor({ state: "hidden" });
  await expanded(false);
  await columnAt(border);
  // This browser keeps the choice.
  await page.reload();
  await page.locator("#page-title", { hasText: "Agreed so far" }).waitFor();
  await expanded(false);
  assert.equal(await sidebar.isVisible(), false);
  await columnAt(border);
  await toggle.click();
  assert.equal(await leftOfFrameMidSlide(), "ground");
  await sidebar.waitFor();
  await columnAt(border + width);

  // At 375px the sidebar starts closed and the page keeps its width under
  // it. Choosing a page closes it, and so does a tap on the dimmed page.
  await page.setViewportSize({ width: 375, height: 812 });
  await sidebar.waitFor({ state: "hidden" });
  await expanded(false);
  await toggle.click();
  await sidebar.waitFor();
  await page.locator("#sidebar-scrim").waitFor();
  await columnAt(border);
  await page.locator('#page-list [data-page="overview"]').click();
  await sidebar.waitFor({ state: "hidden" });
  await title(page, "Overview");
  await toggle.click();
  await sidebar.waitFor();
  await page.mouse.click(360, 400);
  await sidebar.waitFor({ state: "hidden" });
  await page.reload();
  await page.locator("#page-title", { hasText: "Overview" }).waitFor();
  await expanded(false);
  assert.equal(await sidebar.isVisible(), false);
});

// Review and Work are each a few screens tall here, with threads on the
// overall comment and proposals.
test("Review and Work opened from their addresses keep focus on their heading and stay at the top, on a phone and on desktop", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  for (let n = 1; n <= 6; n++) {
    await s.thread("1", "overall");
    const added = await s.session.action("propose", {
      id: `card-${n}`,
      title: `Proposal ${n}`,
      delivers: `Proposal ${n}, delivered.`,
      recommend: "here",
    });
    assert.equal(added.code, 200, added.body.error);
  }
  const page = await open(t, "about:blank");
  if (!page) return;
  const seen = [];
  const expected = [];
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 600 });
    for (const [hash, heading] of [
      ["#feedback", "feedback-title"],
      ["#work", "work-title"],
    ]) {
      await page.goto("about:blank");
      await page.goto(s.url(hash));
      await page.locator(`#${heading}`).waitFor();
      await afterLoad(page);
      seen.push(
        await page.evaluate(
          ([width, hash]) => ({
            width,
            hash,
            focus: document.activeElement.id,
            // The page scrolls in main above 720px and in .app-body below.
            tops: [
              document.scrollingElement,
              document.querySelector("main"),
              document.querySelector(".app-body"),
            ].map((box) => box.scrollTop),
          }),
          [width, hash],
        ),
      );
      expected.push({ width, hash, focus: heading, tops: [0, 0, 0] });
    }
  }
  assert.deepEqual(seen, expected);
});

// A page's headings can carry the IDs the frame gives Work and Review.
test("the sidebar marks the page on screen when the page reuses the IDs of Work and Review", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const published = await session.publish({
    ...planData("1"),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: '<h2 id="work-view">Work</h2><p>Proposals.</p><h2 id="review-view">Feedback</h2>',
      },
    ],
  });
  assert.equal(published.code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`, {
    viewport: { width: 390, height: 800 },
  });
  if (!page) return;
  const marked = () =>
    page
      .locator("#page-list [aria-current=page]")
      .evaluateAll((rows) => rows.map((row) => row.dataset.page));
  await title(page, "Overview");
  await bellReady(page);
  assert.deepEqual(await marked(), ["overview"]);
  assert.equal(new URL(page.url()).hash, "#overview");
  for (const [id, heading] of [
    ["work", "#work-title"],
    ["feedback", "#feedback-title"],
    ["overview", "#page-title"],
  ]) {
    await page.locator("#sidebar-toggle").click();
    await page.locator(`#page-list [data-page="${id}"]`).click();
    await page.locator(heading).waitFor();
    assert.deepEqual(await marked(), [id]);
  }
});

// Inside a linked session, the line under the header names its parent as
// the way back, and stays one line at 375px with long names.
test("a linked session's line under the header leads back to its parent and stays one line", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const long = "Rework the quarterly pricing deck for the board meeting";
  assert.equal((await a.publish({ ...planData(), title: long })).code, 200);
  const proposed = await a.action("propose", {
    id: "deck",
    title: "Build every slide of the appendix with the new chart colors",
    delivers: "The appendix.",
    recommend: "sub-session",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const started = await a.request(`${a.base}/api/proposals/deck/start`, {
    where: "sub-session",
  });
  assert.equal(started.code, 200, started.body.error);
  const child = await h.register(
    path.join(h.config.sessions, crypto.randomUUID()),
    (await h.inbox()).target,
    { start: true, from: a.directory, proposal: "deck" },
  );
  assert.equal(child.code, 200, child.body.error);
  const page = await open(t, child.body.url, {
    viewport: { width: 375, height: 700 },
  });
  if (!page) return;
  const back = page.locator("#history-label a", { hasText: long });
  await back.waitFor({ timeout: 5000 });
  const line = await page.locator("#history-label").evaluate((label) => ({
    height: label.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(label).lineHeight),
    cut: [...label.querySelectorAll(".crumb-name")].some(
      (name) => name.scrollWidth > name.clientWidth,
    ),
  }));
  assert.ok(line.height < line.lineHeight * 1.5, JSON.stringify(line));
  assert.equal(line.cut, true, "a long name is cut short");
  await back.click();
  await page.waitForURL(`${h.server.origin}${a.base}/`);
});

test("a link to a section of the page scrolls to it and stays on the page", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const published = await session.publish({
    ...planData("1"),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: `<p><a href="#later">Go to the later section</a></p>${"<p>Filler paragraph.</p>".repeat(60)}<h2 id="later">The later section</h2><p>Here.</p>`,
      },
    ],
  });
  assert.equal(published.code, 200, JSON.stringify(published.body));
  const page = await open(t, `${h.server.origin}${session.base}/#overview`, {
    viewport: { width: 390, height: 700 },
  });
  if (!page) return;
  await page.locator("#page-title", { hasText: "Overview" }).waitFor();
  await page.locator('#page-content a[href="#later"]').click();
  await page.waitForFunction(() => {
    const box = document
      .querySelector("#page-content #later")
      .getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  });
  await page.locator("#page-title", { hasText: "Overview" }).waitFor();
  assert.equal(new URL(page.url()).hash, "#overview");
});
