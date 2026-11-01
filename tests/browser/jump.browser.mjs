import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const pages = [
  {
    id: "overview",
    title: "Overview",
    html: `
<p>Where a reader starts.</p>
<section class="visual-decision" data-choice="place" data-label="Place">
  <h3>Where should it go?</h3>
  <article class="visual-option" data-value="left" data-label="Left"><p>Beside the capybara.</p></article>
  <article class="visual-option" data-value="right" data-label="Right"><p>Beside the narwhal.</p></article>
</section>`,
  },
  {
    id: "second",
    title: "Second page",
    html: '<p>Opening words.</p><p>A sentence about the walrus.</p><pre data-language="js">const quokka = open();</pre>',
  },
];

async function setUp(t, setup = async () => {}) {
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
  const extra = await setup(h, a);
  const page = await open(t, "about:blank");
  if (!page) return {};
  await stubPele(page);
  const search = (query) => fetch(`${h.server.origin}/api/search?q=${query}`);
  await waitUntil(async () => !(await (await search("x")).json()).loading);
  await page.goto(`${h.server.origin}${a.base}/#overview`);
  await page.locator("#search-button").waitFor();
  // A value on the window survives every move except a page load.
  await page.evaluate(() => (window.sameDocument = true));
  return { h, a, page, extra };
}

async function openResult(page, query, { allSessions = false } = {}) {
  await page.locator("#search-button").click();
  await page.waitForFunction(
    () => document.querySelector(".search-frame").contentWindow?.pairPreview,
  );
  if (allSessions) await page.locator('[data-toggle="allSessions"]').click();
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("q") === query,
  );
  await page.fill(".search-input", query);
  await answered;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.keyboard.press("Enter");
}

const highlighted = (page, word) =>
  page.waitForFunction((word) => {
    const marks = CSS.highlights?.get("plan-search");
    return (
      marks &&
      [...marks].some((range) => {
        const box = range.getBoundingClientRect();
        return (
          range.toString().toLowerCase() === word &&
          box.width > 0 &&
          box.top >= 0 &&
          box.bottom <= innerHeight
        );
      })
    );
  }, word);
const sameDocument = (page) =>
  page.evaluate(() => window.sameDocument === true);
const pageShown = (page) =>
  page.evaluate(() => document.getElementById("page-title").textContent);

test("a block in the current round opens on its page with no load, until the reader moves on", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await openResult(page, "walrus");
  await highlighted(page, "walrus");
  assert.equal(await page.locator("#search-dialog[open]").count(), 0);
  assert.equal(await pageShown(page), "Second page");
  assert.ok(await sameDocument(page));
  const address = new URL(page.url());
  assert.equal(address.searchParams.get("target"), "block-second-1");
  assert.equal(address.searchParams.get("match"), "walrus");
  // Back returns to the page the reader left, with no highlight.
  await page.goBack();
  await page.waitForFunction(
    () => document.getElementById("page-title").textContent === "Overview",
  );
  assert.equal(new URL(page.url()).searchParams.get("match"), null);
  assert.equal(
    await page.evaluate(() => CSS.highlights.has("plan-search")),
    false,
  );
  assert.ok(await sameDocument(page));
});

test("a code block keeps its highlight after the highlighter rewrites it", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await openResult(page, "quokka");
  await page
    .locator("#page-content pre .line, #page-content .shiki")
    .first()
    .waitFor();
  await highlighted(page, "quokka");
});

test("a match in a closed option opens that option", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await openResult(page, "narwhal");
  await highlighted(page, "narwhal");
  assert.equal(
    await page
      .locator('#page-content [role="tab"][aria-selected="true"]')
      .textContent(),
    "Right",
  );
});

test("an alignment opens at its card on Agreed", async (t) => {
  const { page } = await setUp(t);
  if (!page) return;
  await openResult(page, "ocelot");
  await highlighted(page, "ocelot");
  assert.equal(await pageShown(page), "Agreed so far");
  assert.equal(
    new URL(page.url()).searchParams.get("target"),
    "agreement-scope",
  );
  assert.ok(await sameDocument(page));
});

test("a thread message opens on its page with its card showing", async (t) => {
  const { page, extra } = await setUp(t, async (h, a) => {
    const id = crypto.randomUUID();
    const started = await a.request(`${a.base}/api/threads`, {
      id,
      round: "1",
      topic: "second",
      anchor: "Second page",
      target: "block-second-0",
      text: "Does the wombat retry?",
    });
    assert.equal(started.code, 201);
    return id;
  });
  if (!page) return;
  await openResult(page, "wombat");
  await highlighted(page, "wombat");
  assert.equal(await pageShown(page), "Second page");
  assert.equal(
    new URL(page.url()).searchParams.get("target"),
    `thread-${extra}-0`,
  );
});

test("a proposal opens on Work at its card", async (t) => {
  const { page } = await setUp(t, async (h, a) => {
    const proposed = await a.action("propose", {
      id: "tapir-work",
      title: "Teach the tapir",
      delivers: "A tapir that can swim.",
      why: "It sinks.",
      recommend: "here",
      agent: a.agent,
    });
    assert.equal(proposed.code, 200, proposed.body.error);
  });
  if (!page) return;
  await openResult(page, "tapir");
  await highlighted(page, "tapir");
  assert.equal(new URL(page.url()).hash, "#work");
});

// Sending feedback moves the session on, so the older round's cases share one
// session: a sent note opens its card, a block opens in the left tab, and Back
// and a reload both return there.
test("an older round opens live in the left tab, and Back and reload work", async (t) => {
  const { page } = await setUp(t, async (h, a) => {
    const event = a.event("feedback-only", "1", {
      groups: {
        notes: [
          {
            id: "n1",
            round: "1",
            topic: "second",
            anchor: "Second page",
            text: "Rename the iguana.",
          },
        ],
      },
    });
    assert.equal((await a.feedback(event)).code, 200);
    assert.equal((await a.action("read")).code, 200);
    const next = await a.publish({
      ...planData("2"),
      pages: [{ id: "overview", title: "Overview", html: "<p>Round two.</p>" }],
    });
    assert.equal(next.code, 200, next.body.error);
  });
  if (!page) return;
  await page.reload();
  await page.locator("#search-button").waitFor();
  await page.evaluate(() => (window.sameDocument = true));
  await page.waitForFunction(
    () =>
      document.querySelector("#past-tab") &&
      !document.querySelector("#past-tab").disabled,
  );
  await openResult(page, "walrus");
  await highlighted(page, "walrus");
  assert.equal(await pageShown(page), "Second page");
  assert.equal(
    await page.locator("#past-tab").getAttribute("aria-selected"),
    "true",
  );
  assert.equal(new URL(page.url()).searchParams.get("round"), "1");
  assert.ok(await sameDocument(page));
  await page.reload();
  await highlighted(page, "walrus");
  assert.equal(
    await page.locator("#past-tab").getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await pageShown(page), "Second page");
  await page.evaluate(() => (window.sameDocument = true));
  await openResult(page, "iguana");
  await highlighted(page, "iguana");
  assert.equal(new URL(page.url()).hash, "#feedback");
  assert.equal(new URL(page.url()).searchParams.get("target"), "sent-n1");
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#second");
  assert.equal(
    await page.locator("#past-tab").getAttribute("aria-selected"),
    "true",
  );
});

test("another live session opens live at its round, and the draft stays", async (t) => {
  const {
    h,
    a,
    page,
    extra: b,
  } = await setUp(t, async (h) => {
    const other = await h.session();
    const published = await other.publish({
      ...planData(),
      pages: [
        {
          id: "elsewhere",
          title: "Elsewhere",
          html: "<p>The dugong sleeps.</p>",
        },
      ],
    });
    assert.equal(published.code, 200, published.body.error);
    return other;
  });
  if (!page) return;
  const draft = `${h.server.origin}${a.base}/api/draft`;
  await a.request(`${a.base}/api/draft`, {
    changes: {
      "note/n1": {
        id: "n1",
        round: "1",
        topic: "overview",
        anchor: "Overview",
        text: "Unfinished thought.",
      },
    },
  });
  await openResult(page, "dugong", { allSessions: true });
  await page.waitForURL(new RegExp(`/s/${b.id}/`));
  await highlighted(page, "dugong");
  assert.equal(await pageShown(page), "Elsewhere");
  await page.locator("#submit").waitFor();
  assert.equal(await page.locator("#submit").isVisible(), true);
  const kept = await (await fetch(draft)).json();
  assert.equal(kept.items["note/n1"].value.text, "Unfinished thought.");
});

test("a closed session opens read-only and says it is closed", async (t) => {
  const { page, extra: b } = await setUp(t, async (h) => {
    const other = await h.session();
    const published = await other.publish({
      ...planData(),
      pages: [
        {
          id: "elsewhere",
          title: "Elsewhere",
          html: "<p>The dugong sleeps.</p>",
        },
      ],
    });
    assert.equal(published.code, 200, published.body.error);
    assert.equal(
      (await other.request(`${other.base}/api/dismiss`, {})).code,
      200,
    );
    return other;
  });
  if (!page) return;
  await openResult(page, "dugong", { allSessions: true });
  await page.waitForURL(new RegExp(`/s/${b.id}/r/1`));
  await highlighted(page, "dugong");
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.mode),
    "readonly",
  );
  await page.getByText("is closed").first().waitFor();
});
