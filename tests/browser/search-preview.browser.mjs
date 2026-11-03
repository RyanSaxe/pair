import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";
import { chooseInMenu, everywhere } from "../support/search.mjs";

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
// The same, on the page that Open went to.
const pageShows = (page, word) =>
  page.waitForFunction(
    (word) =>
      [...(CSS.highlights?.get("plan-search") ?? [])].some(
        (range) =>
          range.toString().toLowerCase() === word &&
          range.getBoundingClientRect().width > 0,
      ),
    word,
  );
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

test("the preview is the session's own frame, showing the result's whole page", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "walrus");
  await previewShows(page, "walrus");
  const blocks = await visibleBlocks(page);
  assert.ok(blocks.some((text) => text.startsWith("The walrus")));
  assert.ok(blocks.includes("Plan heading"));
  assert.ok(blocks.some((text) => text.includes("lemur")));
  assert.equal(await shown(page).locator("#page-title").isVisible(), true);
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

test("a typo marks the words its row marks, in the preview, after Open and from the address", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  for (const [query, words] of [
    ["walrsu", ["walrus"]],
    // The row marks only these letters of the word.
    ["mnte", ["manatee"]],
    ["lemur sentense", ["lemur", "sentence"]],
  ]) {
    await type(page, query);
    for (const word of words) await previewShows(page, word);
  }
  await page.keyboard.press("Enter");
  await pageShows(page, "lemur");
  await pageShows(page, "sentence");
  await page.reload();
  await pageShows(page, "lemur");
  await pageShows(page, "sentence");
});

test("an exact search of several words marks them as one phrase, and the address keeps them", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "walrus sentence");
  await previewShows(page, "walrus sentence");
  await page.keyboard.press("Enter");
  await pageShows(page, "walrus sentence");
  assert.equal(
    new URL(page.url()).searchParams.get("match"),
    "walrus sentence",
  );
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

test("the reader can scroll a long result, and the page fills the pane", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "pangolin");
  await previewShows(page, "pangolin");
  const read = () =>
    page.evaluate(() => {
      const frame = document.querySelector(".search-frame.is-shown");
      const main = frame.contentDocument.querySelector("main");
      return {
        top: main.scrollTop,
        fills: main.clientHeight === frame.clientHeight,
      };
    });
  const before = await read();
  assert.equal(before.fills, true);
  const box = await page.locator(".search-frame.is-shown").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await waitUntil(async () => (await read()).top < before.top);
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
});

test("a proposal shows on Work, at its card", async (t) => {
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
  assert.equal(await shown(page).locator("#work-title").isVisible(), true);
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
  // A note in the preview opens as a modal, not in a drawer.
  assert.equal(
    await shown(page)
      .locator("#note-dialog")
      .evaluate((dialog) => dialog.matches(":modal")),
    true,
  );
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

test("a proposal in a closed session shows its card, and keys still work", async (t) => {
  const { b, page, origin } = await setUp(t);
  if (!page) return;
  const proposed = await b.action("propose", {
    id: "tapir-closed",
    title: "Teach the closed tapir",
    delivers: "A tapir that can swim.",
    why: "It sinks.",
    recommend: "here",
    agent: b.agent,
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const closed = await fetch(`${origin}${b.base}/api/dismiss`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{}",
  });
  assert.equal(closed.status, 200);
  await chooseInMenu(page, "sessions", "closed");
  await type(page, "closed tapir");
  await previewShows(page, "closed tapir");
  assert.equal(
    await shown(page)
      .locator('[data-proposal-card="tapir-closed"]')
      .isVisible(),
    true,
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.className),
    "search-input",
  );
});

test("a link in a block opens in the reader's tab, and the frame stays embedded", async (t) => {
  const { a, page, origin } = await setUp(t);
  if (!page) return;
  await type(page, "walrus");
  await previewShows(page, "walrus");
  await page.evaluate(() => {
    const doc = document.querySelector(
      ".search-frame.is-shown",
    ).contentDocument;
    const link = doc.createElement("a");
    link.id = "away";
    link.href = "#options";
    link.textContent = "To the options";
    doc.querySelector("#page-content > *").append(link);
  });
  await shown(page).locator("#away").click();
  await page.waitForURL(new RegExp(`${a.base}/#options$`));
  assert.ok(page.url().startsWith(origin));
});

test("a sent note or answer shows its block under the reader's words, and Open goes to its card", async (t) => {
  const { a, page, origin } = await setUp(t);
  if (!page) return;
  const event = a.event("feedback-only", "1", {
    groups: {
      notes: [
        {
          id: "n1",
          round: "1",
          topic: "overview",
          target: "block-overview-1",
          anchor: "Overview",
          text: "An iguana would suit this better.",
        },
        {
          id: "n2",
          round: "1",
          topic: "overview",
          anchor: "Overview",
          text: "A gecko on the whole page.",
        },
      ],
      choices: {
        "options/place": {
          kind: "single",
          round: "1",
          topic: "options",
          label: "Place",
          value: "far",
          valueLabel: "Capybara",
        },
      },
    },
  });
  assert.equal((await a.feedback(event)).code, 200);
  await waitUntil(
    async () =>
      !(await (await fetch(`${origin}/api/search?q=x`)).json()).loading,
  );
  await type(page, "iguana");
  await previewShows(page, "iguana");
  const frame = shown(page);
  assert.match(await frame.locator("#embed-sent").innerText(), /iguana/);
  assert.equal(await frame.locator("#block-overview-1").isVisible(), true);
  assert.equal(await frame.locator("#block-overview-2").isVisible(), true);

  // A choice has no id of its own, so its block is found by the control.
  await type(page, "capybara");
  await previewShows(page, "capybara");
  assert.match(await frame.locator("#embed-sent").innerText(), /Capybara/);
  assert.equal(await frame.locator('[data-choice="place"]').isVisible(), true);

  // A note on a whole page has no block, so it shows its card.
  await type(page, "gecko");
  await previewShows(page, "gecko");
  assert.equal(await frame.locator("#embed-sent").count(), 0);
  assert.equal(await frame.locator("#sent-n2").isVisible(), true);

  await type(page, "iguana");
  await previewShows(page, "iguana");
  await page.keyboard.press("Enter");
  await page.locator("#sent-n1").waitFor();
  assert.equal(new URL(page.url()).hash, "#feedback");
  assert.equal(new URL(page.url()).searchParams.get("target"), "sent-n1");
});

test("a result opened before the page hears its round was sent stays open, at its card", async (t) => {
  const { a, page, origin } = await setUp(t);
  if (!page) return;
  // The round is sent from another browser, and this page's polls hear of it
  // only once the result has opened. The frame's own polls go through.
  let hear;
  const heard = new Promise((done) => (hear = done));
  await page.route(/\/api\/status$/, async (route) => {
    if (route.request().frame() === page.mainFrame()) await heard;
    await route.continue();
  });
  const event = a.event("feedback-only", "1", {
    groups: {
      notes: [
        {
          id: "n1",
          round: "1",
          topic: "overview",
          target: "block-overview-1",
          anchor: "Overview",
          text: "An iguana would suit this better.",
        },
      ],
    },
  });
  assert.equal((await a.feedback(event)).code, 200);
  await waitUntil(
    async () =>
      !(await (await fetch(`${origin}/api/search?q=x`)).json()).loading,
  );
  await type(page, "iguana");
  await previewShows(page, "iguana");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.hash === "#feedback");
  const status = page.waitForResponse(
    async (response) =>
      new URL(response.url()).pathname.endsWith("/api/status") &&
      response.frame() === page.mainFrame() &&
      (await response.json()).latestSubmissionRound === "1",
  );
  hear();
  await status;
  await page.locator("#sent-n1").waitFor();
  assert.equal(new URL(page.url()).hash, "#feedback");
  assert.equal(new URL(page.url()).searchParams.get("target"), "sent-n1");
});

test("a preview shows at its full width from its first frame", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await page.evaluate(() => {
    window.widths = [];
    const sample = () => {
      const frame = document.querySelector(".search-frame.is-shown");
      const content = frame?.contentDocument?.querySelector(".content");
      if (content) window.widths.push(content.getBoundingClientRect().width);
      requestAnimationFrame(sample);
    };
    sample();
  });
  await type(page, "walrus");
  await previewShows(page, "walrus");
  await page.waitForTimeout(400);
  const widths = await page.evaluate(() => window.widths);
  assert.ok(widths.length > 0);
  assert.deepEqual([...new Set(widths)].length, 1, String(new Set(widths)));
});

test("a preview shows once its words have landed, with the line while it waits", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await page.route(/\/api\/page\?/, async (route) => {
    await new Promise((done) => setTimeout(done, 700));
    await route.fallback();
  });
  await page.evaluate(() => {
    window.seen = [];
    const sample = () => {
      const main = document.querySelector(".search-preview-main");
      const frame = document.querySelector(".search-frame.is-shown");
      const marks = frame?.contentWindow.CSS.highlights?.get("plan-search");
      const mark = marks && [...marks][0];
      window.seen.push({
        loading: main.classList.contains("is-loading"),
        shown: Boolean(frame),
        marked: Boolean(mark),
        scroll: frame?.contentDocument.documentElement.scrollTop,
      });
      requestAnimationFrame(sample);
    };
    sample();
  });
  await type(page, "pangolin");
  await previewShows(page, "pangolin");
  await page.waitForTimeout(500);
  const seen = await page.evaluate(() => window.seen);
  assert.ok(seen.some(({ loading, shown }) => loading && !shown));
  const onScreen = seen.filter(({ shown }) => shown);
  assert.ok(onScreen.length > 0);
  assert.equal(
    onScreen.some(({ loading }) => loading),
    false,
  );
  // Its words are marked from the first frame it shows, and the page never moves.
  assert.equal(onScreen[0].marked, true);
  assert.equal(new Set(onScreen.map(({ scroll }) => scroll)).size, 1);
});

test("the result on screen stays until the next is ready", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "walrus");
  await previewShows(page, "walrus");
  await page.route(/\/api\/page\?/, async (route) => {
    await new Promise((done) => setTimeout(done, 600));
    await route.fallback();
  });
  await page.evaluate(() => {
    window.frames_ = [];
    const sample = () => {
      const frame = document.querySelector(".search-frame.is-shown");
      window.frames_.push({
        shown: Boolean(frame),
        opacity: frame ? getComputedStyle(frame).opacity : null,
        loading: document
          .querySelector(".search-preview-main")
          .classList.contains("is-loading"),
      });
      requestAnimationFrame(sample);
    };
    sample();
  });
  await type(page, "pangolin");
  // The search's reply can reach this process before the page has read it, so a
  // wait for the line to end needs the line to have started. The words mark
  // before the line ends, so previewShows can't stand in for this.
  await page.waitForFunction(
    () =>
      window.frames_.some(({ loading }) => loading) &&
      !window.frames_.at(-1).loading,
  );
  await previewShows(page, "pangolin");
  const frames = await page.evaluate(() => window.frames_);
  assert.ok(frames.every(({ shown }) => shown));
  assert.ok(
    frames.some(({ loading, opacity }) => loading && opacity === "0.35"),
  );
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".search-frame.is-shown"))
          .opacity,
    ),
    "1",
  );
});

test("another result on the page on screen just moves the page", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await type(page, "sentence");
  await previewShows(page, "sentence");
  const moves = await page.evaluate(async () => {
    const frame = document.querySelector(".search-frame.is-shown");
    const first = frame.contentDocument.querySelector("#page-content > p");
    const row = () =>
      document.querySelector('.search-row[aria-selected="true"]');
    const before = row().dataset.i;
    const dims = [];
    const sample = () => {
      dims.push(getComputedStyle(frame).opacity);
      if (window.sampling) requestAnimationFrame(sample);
    };
    window.sampling = true;
    sample();
    document.querySelector(".search-input").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((done) => setTimeout(done, 600));
    window.sampling = false;
    return {
      moved: row().dataset.i !== before,
      same: first.isConnected,
      dimmed: dims.includes("0.35"),
    };
  });
  assert.deepEqual(moves, { moved: true, same: true, dimmed: false });
});

test("moving to a retired Agreed card in an older round shows it at once, with its fold open", async (t) => {
  const { h, page, origin } = await setUp(t);
  if (!page) return;
  const old = await h.session();
  const first = await old.publish({
    ...planData(),
    agreements: [
      {
        id: "old-scope",
        title: "Old scope",
        html: "<p>The capuchin left.</p>",
        state: "retired",
        sourceRefs: [{ kind: "conversation", text: "Said in chat." }],
      },
    ],
    pages: [{ id: "overview", title: "Overview", html: "<p>Round one.</p>" }],
  });
  assert.equal(first.code, 200, first.body.error);
  assert.equal((await old.feedback(old.event("feedback-only", "1"))).code, 200);
  assert.equal((await old.action("read")).code, 200);
  const second = await old.publish({
    ...planData("2"),
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: "<p>The capuchin stayed.</p>",
      },
    ],
  });
  assert.equal(second.code, 200, second.body.error);
  await waitUntil(
    async () =>
      !(await (await fetch(`${origin}/api/search?q=x`)).json()).loading,
  );
  await everywhere(page);
  await type(page, "capuchin");
  await previewShows(page, "capuchin");
  // Go to the page's row first, so the card is a step from another round.
  const selected = page.locator('.search-row[aria-selected="true"]');
  const onCard = async () => /Agreed/.test(await selected.innerText());
  if (await onCard()) {
    await page.keyboard.press("ArrowDown");
    await previewShows(page, "capuchin");
    await page.waitForFunction(
      () => !document.querySelector(".search-preview-main.is-loading"),
    );
    await page.keyboard.press("ArrowUp");
  } else await page.keyboard.press("ArrowDown");
  assert.equal(await onCard(), true);
  const started = Date.now();
  await page.waitForFunction(() =>
    document.querySelector(".search-preview-main.is-loading"),
  );
  await page.waitForFunction(
    () => !document.querySelector(".search-preview-main.is-loading"),
    null,
    { timeout: 20000 },
  );
  // A closed fold around the result used to hold it back for the whole limit.
  assert.ok(Date.now() - started < 8000, `${Date.now() - started} ms`);
  assert.equal(
    await shown(page)
      .locator(".agreement-retired")
      .evaluate((node) => node.open),
    true,
  );
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
  await chooseInMenu(page, "sessions", "closed");
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
