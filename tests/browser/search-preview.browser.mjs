import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const pages = [
  {
    id: "overview",
    title: "Overview",
    html: `<h2>Plan heading</h2>
<p>The walrus sentence, with its own block.</p>
<p>A lemur sentence on the next block.</p>
<h2 id="own-heading">A heading with its own id</h2>
<table id="own-table"><tr><td>The manatee cell</td></tr></table>`,
  },
  {
    id: "options",
    title: "Options",
    html: `<section class="visual-decision" data-choice="place" data-label="Place">
  <h3>Where does the breaker live?</h3>
  <article class="visual-option" data-value="near" data-label="Near"><header>Near</header><p>One breaker per process.</p></article>
  <article class="visual-option" data-value="far" data-label="Far"><header>Far</header><p>An envoy beside it.</p></article>
  <article class="visual-option" data-value="hub" data-label="Hub"><header>Hub</header><p>One shared breaker.</p></article>
  <article class="visual-option" data-value="none" data-label="None"><header>None</header><p>Nothing at all.</p></article>
</section>
<details><summary>Raw source</summary><pre data-language="text">${"filler line\n".repeat(400)}function pangolin() {}\n${"filler line\n".repeat(400)}</pre></details>`,
  },
];
pages.push({
  id: "figure",
  title: "Quokka figure",
  html: `<div data-diagram data-caption="The quokka's path.">flowchart LR
  A["Quokka"] --> B["Burrow"]</div>`,
});
const otherPages = [
  {
    id: "elsewhere",
    title: "Elsewhere",
    html: `<p>The dugong sleeps here.</p>
<section class="decision" data-choice="sleep" data-label="Sleep">
  <h3>When should the dugong sleep?</h3>
  <button class="decision-option" type="button" data-value="dawn" data-label="Dawn"><b>Dawn</b><p>At first light.</p></button>
  <button class="decision-option" type="button" data-value="dusk" data-label="Dusk"><b>Dusk</b><p>At nightfall.</p></button>
</section>`,
  },
];

async function setUp(t, options = {}) {
  const h = await hub(t);
  const a = await h.session();
  const published = await a.publish({
    ...planData(),
    agreements: [
      {
        id: "scope",
        title: "Scope",
        html: "<p>The ocelot stays out.</p>",
        sourceRefs: [{ kind: "conversation", text: "Said in chat." }],
      },
    ],
    pages,
  });
  assert.equal(published.code, 200, published.body.error);
  const b = await h.session();
  const other = await b.publish({ ...planData(), pages: otherPages });
  assert.equal(other.code, 200, other.body.error);
  const page = await open(t, "about:blank", options);
  if (!page) return {};
  await stubPele(page);
  const origin = h.server.origin;
  await waitUntil(
    async () =>
      !(await (await fetch(`${origin}/api/search?q=x`)).json()).loading,
  );
  await page.goto(`${origin}${a.base}/#overview`);
  await page.locator("#search-button").waitFor();
  await page.locator("#search-button").click();
  return { h, a, b, page, origin };
}

const everywhere = (page) =>
  page.locator('[data-toggle="allSessions"]').click();
const type = async (page, query) => {
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("q") === query,
  );
  await page.fill(".search-input", query);
  await answered;
};
const shown = (page) => page.frameLocator(".search-frame.is-shown");
// The frame's words on screen, once its highlight has the word.
const previewShows = (page, word) =>
  page.waitForFunction((word) => {
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
  }, word);
const visibleBlocks = (page) =>
  page.evaluate(() => {
    const doc = document.querySelector(
      ".search-frame.is-shown",
    ).contentDocument;
    return [...doc.querySelectorAll("#page-content > *")]
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => element.textContent.trim().slice(0, 40));
  });
const draftOf = async (origin, session) =>
  Object.keys(
    (await (await fetch(`${origin}${session.base}/api/draft`)).json()).items,
  );

test("the preview is the session's own frame, showing only the result's block", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "walrus");
  await previewShows(page, "walrus");
  const blocks = await visibleBlocks(page);
  assert.ok(blocks.some((text) => text.startsWith("The walrus")));
  assert.ok(blocks.includes("Plan heading"));
  assert.ok(!blocks.some((text) => text.includes("lemur")));
  assert.equal(await shown(page).locator(".frame-header").isVisible(), false);
  // A second result in the session stays in the same frame, with no load.
  await page.evaluate(() => {
    document.querySelector(
      ".search-frame.is-shown",
    ).contentWindow.sameDocument = true;
  });
  await type(page, "lemur");
  await previewShows(page, "lemur");
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector(".search-frame.is-shown").contentWindow
          .sameDocument,
    ),
    true,
  );
  assert.equal(await page.locator(".search-frame").count(), 1);
});

test("a block with its own id shows in the preview, and Open lands on it", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "manatee");
  await previewShows(page, "manatee");
  const blocks = await visibleBlocks(page);
  assert.ok(blocks.some((text) => text.startsWith("The manatee")));
  assert.equal(blocks.length, 2);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const marks = CSS.highlights?.get("plan-search");
    return (
      marks &&
      [...marks].some((range) => {
        const box = range.getBoundingClientRect();
        return box.width > 0 && box.top >= 0 && box.bottom <= innerHeight;
      })
    );
  });
  assert.equal(new URL(page.url()).searchParams.get("target"), "own-table");
});

test("a block shows the part with the most of the reader's words, and a tie stays put", async (t) => {
  // At this width the options are tabs, and only one shows.
  const { page } = await setUp(t, { viewport: { width: 1000, height: 800 } });
  if (!page) return;
  const open = () =>
    shown(page)
      .locator('#page-content [role="tab"][aria-selected="true"]')
      .textContent();
  // "one breaker" is on the open option and on another, which is a tie.
  await type(page, "one breaker");
  await previewShows(page, "one breaker");
  assert.equal(await open(), "Near");
  // "envoy" is only on another option, which with the heading shows both words.
  await type(page, "breaker envoy");
  await previewShows(page, "envoy");
  assert.equal(await open(), "Far");
});

test("a tie stays on the open option when the frame is new", async (t) => {
  const { page } = await setUp(t, { viewport: { width: 1000, height: 800 } });
  if (!page) return;
  await type(page, "live breaker");
  await previewShows(page, "breaker");
  await page.waitForTimeout(400);
  assert.equal(
    await shown(page)
      .locator('#page-content [role="tab"][aria-selected="true"]')
      .textContent(),
    "Near",
  );
});

test("a figure that never finishes drawing leaves the search window working", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await page.route(/pele@[^/]+\/dist\/pele\.js$/, () => {});
  await type(page, "quokka");
  await page.locator(".search-frame.is-shown").waitFor();
  await page.waitForTimeout(16000);
  const alive = await Promise.race([
    page.evaluate(() => "alive"),
    new Promise((done) => setTimeout(() => done("frozen"), 3000)),
  ]);
  assert.equal(alive, "alive");
});

test("a key typed with focus in the frame goes to the search field, whole", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "walrus");
  await previewShows(page, "walrus");
  await shown(page).locator("#page-content p").first().click();
  await page.keyboard.type("ab");
  assert.equal(await page.inputValue(".search-input"), "walrusab");
});

test("a page title's result shows the page from its title down", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "options");
  await page.locator(".search-frame.is-shown").waitFor();
  await shown(page).locator("#page-title").waitFor();
  assert.equal(
    await shown(page).locator("#page-title").textContent(),
    "Options",
  );
  assert.equal(await shown(page).locator(".search-matched").count(), 0);
});

test("a word in a long fold opens the fold and scrolls to the word itself", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "pangolin");
  await previewShows(page, "pangolin");
  assert.equal(
    await shown(page).locator("#page-content details").getAttribute("open"),
    "",
  );
});

test("a thread on a block shows the block with the thread's real card", async (t) => {
  const { a, page } = await setUp(t);
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
  await type(page, "wombat");
  await previewShows(page, "wombat");
  await shown(page).locator("pair-thread").waitFor();
  const blocks = await visibleBlocks(page);
  assert.ok(blocks.some((text) => text.startsWith("The walrus")));
  assert.ok(!blocks.some((text) => text.includes("lemur")));
});

test("a proposal shows its Work card with nothing else from Work", async (t) => {
  const { a, page } = await setUp(t);
  if (!page) return;
  const proposed = await a.action("propose", {
    id: "tapir-work",
    title: "Teach the tapir",
    delivers: "A tapir that can swim.",
    why: "It sinks.",
    recommend: "here",
    agent: a.agent,
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  await type(page, "tapir");
  await previewShows(page, "tapir");
  assert.equal(await shown(page).locator("#work-title").isVisible(), false);
  assert.equal(
    await shown(page).locator('[data-proposal-card="tapir-work"]').isVisible(),
    true,
  );
});

test("a comment and a thread started in the search window go to the result's session", async (t) => {
  const { a, b, page, origin } = await setUp(t);
  if (!page) return;
  await everywhere(page);
  await type(page, "dugong sleeps");
  await previewShows(page, "dugong sleeps");
  await shown(page).locator("#page-content p").first().click();
  await shown(page).locator("#comment-here").click();
  // The dialog names where the comment goes.
  assert.match(
    await shown(page).locator("#note-anchor").textContent(),
    /Round 1/,
  );
  await shown(page).locator("#note-text").pressSequentially("A dugong note");
  assert.equal(await page.inputValue(".search-input"), "dugong sleeps");
  await shown(page).locator("#note-save").click();
  await waitUntil(async () => (await draftOf(origin, b)).length === 1);
  assert.deepEqual(await draftOf(origin, a), []);

  await shown(page).locator("#comment-here").click();
  await shown(page).locator("#note-text").fill("A dugong thread");
  await shown(page).locator("#note-thread").click();
  await waitUntil(
    async () =>
      (await (await fetch(`${origin}${b.base}/api/status`)).json()).threads
        .length === 1,
  );
  const status = await (await fetch(`${origin}${b.base}/api/status`)).json();
  assert.equal(status.threads[0].round, "1");
  assert.equal(status.threads[0].topic, "elsewhere");
  const home = await (await fetch(`${origin}${a.base}/api/status`)).json();
  assert.deepEqual(home.threads, []);
});

test("a choice made on the page shows in the preview, and one made there saves there", async (t) => {
  const { b, page, origin } = await setUp(t);
  if (!page) return;
  await everywhere(page);
  await type(page, "first light");
  await previewShows(page, "first light");
  const option = (value) =>
    shown(page).locator(`.decision-option[data-value="${value}"]`);
  await option("dusk").click();
  await waitUntil(async () => (await draftOf(origin, b)).length === 1);
  assert.equal(await option("dusk").getAttribute("aria-pressed"), "true");
});

test("keys belong to the search field until the reader writes in the frame", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "sentence");
  await previewShows(page, "sentence");
  // A frame that loads never takes the keys.
  assert.equal(
    await page.evaluate(() => document.activeElement.className),
    "search-input",
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.evaluate(() => document.activeElement.className),
    "search-input",
  );
  await shown(page).locator("#comment-here").click();
  await shown(page).locator("#note-text").pressSequentially("hello");
  assert.equal(await page.inputValue(".search-input"), "sentence");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".search-frame.is-shown")
        .contentDocument.getElementById("note-dialog").open,
  );
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  await shown(page).locator("body").press("Escape");
  await page.locator("#search-dialog[open]").waitFor({ state: "detached" });
});

test("moving through results adds nothing to Back or to what the reader has opened", async (t) => {
  const { a, page, origin } = await setUp(t);
  if (!page) return;
  const before = await page.evaluate(() => history.length);
  const opened = async () =>
    (await (await fetch(`${origin}/api/opened`)).text()) || "";
  const openedBefore = await opened();
  await type(page, "sentence");
  await previewShows(page, "sentence");
  await page.keyboard.press("ArrowDown");
  await type(page, "breaker");
  await previewShows(page, "breaker");
  assert.equal(await page.evaluate(() => history.length), before);
  assert.equal(await opened(), openedBefore);
  // The reader's place in the session isn't touched either.
  const place = await page.evaluate(
    (id) => localStorage.getItem(`pair:place:${id}`),
    a.id,
  );
  assert.doesNotMatch(place ?? "", /options/);
});

test("the last few frames stay loaded, and a session comes back with no load", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await everywhere(page);
  await type(page, "walrus");
  await previewShows(page, "walrus");
  await page.evaluate(() => {
    document.querySelector(
      ".search-frame.is-shown",
    ).contentWindow.sameDocument = true;
  });
  await type(page, "dugong sleeps");
  await previewShows(page, "dugong sleeps");
  assert.equal(await page.locator(".search-frame").count(), 2);
  await type(page, "walrus");
  await previewShows(page, "walrus");
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector(".search-frame.is-shown").contentWindow
          .sameDocument,
    ),
    true,
  );
});

test("an older round opens in the session's frame, read-only like the page", async (t) => {
  const { a, page, origin } = await setUp(t);
  if (!page) return;
  const event = a.event("feedback-only", "1");
  assert.equal((await a.feedback(event)).code, 200);
  assert.equal((await a.action("read")).code, 200);
  const next = await a.publish({
    ...planData("2"),
    pages: [{ id: "overview", title: "Overview", html: "<p>Round two.</p>" }],
  });
  assert.equal(next.code, 200, next.body.error);
  await waitUntil(
    async () =>
      !(await (await fetch(`${origin}/api/search?q=x`)).json()).loading,
  );
  // A slow page must leave nothing else showing under the result's title.
  await page.route(/\/api\/page\?/, async (route) => {
    await new Promise((done) => setTimeout(done, 700));
    await route.fallback();
  });
  await type(page, "walrus");
  await page.locator(".search-frame.is-shown").waitFor();
  const firstShown = await page.evaluate(() => {
    const content = document
      .querySelector(".search-frame.is-shown")
      .contentDocument.getElementById("page-content");
    return [content.dataset.round, content.dataset.pageId];
  });
  assert.deepEqual(firstShown, ["1", "overview"]);
  await previewShows(page, "walrus");
  // The frame works this out once the round's status arrives.
  await shown(page).locator("#comment-here").waitFor({ state: "hidden" });
});

test("a closed session shows read-only", async (t) => {
  const { b, page, origin } = await setUp(t);
  if (!page) return;
  const closed = await fetch(`${origin}${b.base}/api/dismiss`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{}",
  });
  assert.equal(closed.status, 200);
  await everywhere(page);
  await type(page, "dugong sleeps");
  await previewShows(page, "dugong sleeps");
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector(".search-frame.is-shown").contentDocument
          .documentElement.dataset.mode,
    ),
    "readonly",
  );
  assert.equal(await shown(page).locator("#comment-here").isVisible(), false);
});

test("leaving the search window stops what plays in a frame", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "walrus");
  await previewShows(page, "walrus");
  await page.evaluate(() => {
    const win = document.querySelector(".search-frame.is-shown").contentWindow;
    win.pauses = 0;
    const video = win.document.createElement("video");
    video.pause = () => win.pauses++;
    win.document.getElementById("page-content").append(video);
  });
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelector(".search-frame").contentWindow.pauses === 1,
  );
  // The frame stays loaded, and it asks the hub for nothing while it's closed.
  const asked = [];
  page.on("request", (request) => {
    if (
      request.frame() !== page.mainFrame() &&
      request.url().includes("/api/status")
    )
      asked.push(request.url());
  });
  await page.waitForTimeout(11000);
  assert.deepEqual(asked, []);
});

test("a theme change reaches a frame that's already loaded", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "walrus");
  await previewShows(page, "walrus");
  await page.keyboard.press("Escape");
  await page.locator("#settings").click();
  await page.locator('#theme [data-theme="dark"]').click();
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector(".search-frame").contentDocument.documentElement
          .dataset.theme,
    ),
    "dark",
  );
});
