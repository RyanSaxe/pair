import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, root, sleep, waitUntil } from "../support/hub.mjs";

// The frame polls the status every 1.5 s, so this allows two polls.
const TWO_POLLS_MS = 3300;
const RELOAD_MS = 8000;

const long = (prefix) =>
  Array.from(
    { length: 30 },
    (_, index) =>
      `<h2 id="${prefix}-${index}">Section ${index}</h2><p>${"Words the reader reads. ".repeat(20)}</p>`,
  ).join("");
const choices = Array.from(
  { length: 25 },
  (_, index) =>
    `<div data-choice="pick-${index}" data-label="Pick ${index}"><button type="button" data-value="a">A</button><button type="button" data-value="b">B</button></div>`,
).join("");

// session publishes round 1, its feedback and round 2, so a tab can read round 1
// as an older round or at its read-only address. A thread on each round has a
// reply box.
async function session(t) {
  const h = await hub(t);
  const a = await h.session();
  const round = (number, id, html) => ({
    ...planData(number),
    pages: [{ id, title: `Page ${id}`, html }],
  });
  const ask = (id, number, topic) =>
    a.request(`${a.base}/api/threads`, {
      id,
      round: number,
      topic,
      anchor: "The page",
      text: "What happens to a failed item?",
    });
  assert.equal((await a.publish(round("1", "older", long("old")))).code, 200);
  assert.equal((await ask("past", "1", "older")).code, 201);
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal((await a.action("read")).code, 200);
  const next = round("2", "newer", choices + long("new"));
  const published = await a.publish(next);
  assert.equal(published.code, 200, published.body.error);
  assert.equal((await ask("here", "2", "newer")).code, 201);
  return { h, a, origin: h.server.origin };
}
// reportVersion rewrites the status every frame on the page gets, the way a hub
// on other code would answer it. A version of undefined is a hub too old to
// send one.
async function reportVersion(page) {
  const reported = { rewrite: false, version: undefined };
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    if (reported.rewrite) json.hubVersion = reported.version;
    await route.fulfill({ response, json });
  });
  return (version) => {
    reported.rewrite = true;
    reported.version = version;
  };
}
// A reload clears what a script left on the window.
const markLoad = (frame) => frame.evaluate(() => (window.sameLoad = true));
const sameLoad = (frame) => frame.evaluate(() => window.sameLoad === true);
// The check itself can land in the middle of the reload, and then it asks again.
const reloads = (page) =>
  waitUntil(
    () =>
      sameLoad(page).then(
        (same) => !same,
        () => false,
      ),
    RELOAD_MS,
  );
const places = `[document.querySelector("main"), document.querySelector(".app-body")].find((element) => /auto|scroll/.test(getComputedStyle(element).overflowY))`;
const scrollTo = (page, top) => page.evaluate(`(${places}).scrollTop = ${top}`);
const scrollTop = (page) => page.evaluate(`(${places}).scrollTop`);
const replyBox = (page, thread) =>
  page
    .locator(`pair-thread[data-thread="${thread}"]`)
    .getByRole("textbox", { name: "Reply in this thread" });

// A checkout with one more file in src/ has a new version, with no setting for
// a test to change, and the hub on it reads the same state directory.
async function restartOnNewCode(t, h) {
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "pair-new-hub-"));
  for (const item of ["src", "adapters", "guide", "package.json"])
    await fs.cp(path.join(root, item), path.join(copy, item), {
      recursive: true,
    });
  await fs.writeFile(path.join(copy, "src/new-code.txt"), "new code");
  const { port } = new URL(h.server.origin);
  return async () => {
    const child = spawn(
      process.execPath,
      [path.join(copy, "src/cli.mjs"), "hub"],
      { env: { ...h.env, PAIR_HUB_PORT: port }, stdio: "ignore" },
    );
    t.after(async () => {
      child.kill();
      await fs.rm(copy, { recursive: true, force: true });
    });
    const answers = await waitUntil(async () => {
      const response = await fetch(`${h.server.origin}/api/hub`).catch(
        () => null,
      );
      return response?.ok && (await response.json()).pid === child.pid;
    }, 10000);
    assert.equal(answers, true);
  };
}

test("a tab stays while its hub is down, then reloads once on the new code, at its page and place", async (t) => {
  const { h, a, origin } = await session(t);
  const page = await open(t, `${origin}${a.base}/#newer`);
  if (!page) return;
  await page.locator("#new-20").waitFor();
  await page.locator("#new-20").evaluate((block) => block.scrollIntoView());
  await sleep(400);
  const above = () =>
    page
      .locator("#new-20")
      .evaluate((block) => block.getBoundingClientRect().top);
  const before = await above();
  await markLoad(page);
  let loads = 0;
  page.on("load", () => loads++);

  const startNewHub = await restartOnNewCode(t, h);
  await h.server.close();
  await sleep(TWO_POLLS_MS);
  assert.equal(await sameLoad(page), true, "reloaded with the hub down");
  await startNewHub();
  assert.equal(await reloads(page), true, "did not reload on the new hub");

  await page.locator("#new-20").waitFor();
  await waitUntil(async () => Math.abs((await above()) - before) < 2);
  assert.ok(Math.abs((await above()) - before) < 2, "lost the place");
  assert.equal(new URL(page.url()).hash, "#newer");
  await sleep(TWO_POLLS_MS);
  assert.equal(loads, 1, "reloaded more than once");
});

test("a status with no version changes nothing, and each new version gets one reload", async (t) => {
  const { a, origin } = await session(t);
  const page = await open(t, "about:blank");
  if (!page) return;
  const report = await reportVersion(page);
  await page.goto(`${origin}${a.base}/#newer`);
  await page.locator("#new-1").waitFor();
  await markLoad(page);
  let loads = 0;
  page.on("load", () => loads++);

  report(undefined);
  await sleep(TWO_POLLS_MS);
  assert.equal(loads, 0, "reloaded for a hub with no version");

  // The page after this reload still differs, as it would from a cache.
  report("another-version");
  assert.equal(await reloads(page), true);
  await sleep(TWO_POLLS_MS);
  assert.equal(loads, 1, "reloaded again for the same version");

  await markLoad(page);
  report("a-later-version");
  assert.equal(await reloads(page), true);
  assert.equal(await waitUntil(() => loads === 2), true);
});

test("a reload waits while the reader is using the tab, and comes once they finish", async (t) => {
  const { a, origin } = await session(t);
  const page = await open(t, "about:blank");
  if (!page) return;
  await page.addInitScript(() => {
    // A phone can report this while the keyboard is up.
    document.hasFocus = () => false;
  });
  const report = await reportVersion(page);
  await page.goto(`${origin}${a.base}/#newer`);
  const box = replyBox(page, "here");
  await box.waitFor();
  let version = 0;
  const holdsUntil = async (finish, what) => {
    await markLoad(page);
    report(`version-${++version}`);
    await sleep(TWO_POLLS_MS);
    assert.equal(await sameLoad(page), true, `${what} did not hold the reload`);
    await finish();
    assert.equal(await reloads(page), true, `no reload after ${what}`);
  };

  await box.click();
  await page.keyboard.type("Typed across a restart");
  await holdsUntil(async () => {
    assert.equal(await box.inputValue(), "Typed across a restart");
    assert.equal(
      await page.evaluate(() => document.activeElement.tagName),
      "TEXTAREA",
    );
    await box.blur();
  }, "a reply box");
  await box.waitFor();
  assert.equal(await box.inputValue(), "Typed across a restart");

  await page.locator("#new-2").waitFor();
  await page.locator("#new-2").selectText();
  await holdsUntil(
    () => page.evaluate(() => getSelection().removeAllRanges()),
    "selected text",
  );

  await page.locator("#note-dialog").waitFor({ state: "attached" });
  await page.evaluate(() => document.getElementById("note-dialog").showModal());
  await holdsUntil(
    () => page.evaluate(() => document.getElementById("note-dialog").close()),
    "the note dialog",
  );

  // A reply's image is not in the draft until its upload answers.
  await box.waitFor();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/api/upload", async (route) => {
    await held;
    await route.continue();
  });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .locator('pair-thread[data-thread="here"]')
      .getByRole("button", { name: "Add an image" })
      .click(),
  ]);
  await chooser.setFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  await holdsUntil(async () => release(), "an upload");
  await page
    .locator('pair-thread[data-thread="here"] .thread-reply figure')
    .waitFor();
});

test("a reply typed on an older round, which the frame doesn't save, holds the reload", async (t) => {
  const { a, origin } = await session(t);
  const page = await open(t, "about:blank");
  if (!page) return;
  const report = await reportVersion(page);
  await page.goto(`${origin}${a.base}/?round=1#older`);
  const box = replyBox(page, "past");
  await box.waitFor();
  await box.fill("Only in this tab");
  await box.blur();
  await markLoad(page);
  report("another-version");
  await sleep(TWO_POLLS_MS);
  assert.equal(await sameLoad(page), true);
  assert.equal(await box.inputValue(), "Only in this tab");
  await box.fill("");
  await box.blur();
  assert.equal(await reloads(page), true);
});

test("the search window's frame keeps its load, and the tab reloads after the window closes", async (t) => {
  const { a, origin } = await session(t);
  const page = await open(t, "about:blank");
  if (!page) return;
  await stubPele(page);
  const report = await reportVersion(page);
  await page.goto(`${origin}${a.base}/#newer`);
  await page.locator("#search-button").click();
  await waitUntil(
    async () =>
      !(await (await fetch(`${origin}/api/search?q=x`)).json()).loading,
  );
  await page.fill(".search-input", "reader");
  await page.locator(".search-frame.is-shown").waitFor();
  const frame = page.frames().find((each) => each.url().includes("/embed/"));
  assert.ok(frame, "no search frame");
  await markLoad(page);
  await markLoad(frame);
  report("another-version");
  // The search window's frame polls every 10 s.
  await sleep(11000);
  assert.equal(await sameLoad(frame), true, "the search frame reloaded itself");
  assert.equal(await sameLoad(page), true, "the tab reloaded under the search");
  await page.keyboard.press("Escape");
  assert.equal(await reloads(page), true);
  assert.equal(await page.locator(".search-input").isVisible(), false);
});

test("a reload keeps the place on an older round, a read-only page, Work's tab, Review, a sent round and past an address's target", async (t) => {
  const { a, origin } = await session(t);
  const propose = async (fields) =>
    assert.equal((await a.action("propose", fields)).code, 200);
  for (const id of ["one", "two", "three", "four", "five", "six"])
    await propose({
      id,
      title: `Card ${id}`,
      delivers: "What this work delivers, so that the card has some height.",
      recommend: "here",
    });
  // A running card makes Running the tab that Work opens on.
  await propose({ id: "one", start: "here", quote: "Build it." });
  const page = await open(t, "about:blank");
  if (!page) return;
  const context = await page
    .context()
    .browser()
    .newContext({ viewport: { width: 900, height: 420 } });
  const picks = await context.newPage();
  await picks.goto(`${origin}${a.base}/#newer`);
  for (let index = 0; index < 25; index++)
    await picks
      .locator(`[data-choice="pick-${index}"] [data-value="a"]`)
      .click();
  await picks.close();

  const check = async ({ what, address, ready, at, before = () => {} }) => {
    const tab = await context.newPage();
    const report = await reportVersion(tab);
    await tab.goto(`${origin}${a.base}${address}`);
    await before(tab);
    await ready(tab);
    await sleep(400);
    await scrollTo(tab, at);
    await sleep(400);
    const top = await scrollTop(tab);
    assert.ok(top > 0, `${what} has no scroll to keep`);
    const url = new URL(tab.url());
    url.searchParams.delete("target");
    await markLoad(tab);
    report("another-version");
    assert.equal(await reloads(tab), true, `${what} did not reload`);
    await ready(tab);
    const kept = await waitUntil(
      async () => Math.abs((await scrollTop(tab)) - top) < 3,
      RELOAD_MS,
    );
    assert.equal(
      kept,
      true,
      `${what} went to ${await scrollTop(tab)}, not ${top}`,
    );
    assert.equal(tab.url(), url.href, `${what} changed its address`);
    await tab.close();
  };
  const shows = (selector) => (tab) => tab.locator(selector).waitFor();
  await check({
    what: "an older round",
    address: "/?round=1#older",
    ready: shows("#old-15"),
    at: 1500,
  });
  await check({
    what: "a read-only page",
    address: "/r/1#older",
    ready: shows("#old-15"),
    at: 1500,
  });
  await check({
    what: "an address's target",
    address: "/?target=new-4#newer",
    ready: shows("#new-4"),
    at: 2500,
  });
  await check({
    what: "Work",
    address: "/#work",
    before: async (tab) => {
      await tab.locator("#work-tab-running[aria-selected=true]").waitFor();
      await tab.locator("#work-tab-proposed").click();
    },
    ready: shows("#work-tab-proposed[aria-selected=true]"),
    at: 200,
  });
  await check({
    what: "Review",
    address: "/#feedback",
    ready: shows("#review-view:not([hidden])"),
    at: 200,
  });
  const sent = await a.feedback(a.event("feedback-only", "2"));
  assert.equal(sent.code, 200, sent.body.error);
  await check({
    what: "a sent round while Current waits",
    address: "/#agreed",
    before: async (tab) => {
      await tab.locator("#past-tab:not([disabled])").waitFor();
      await tab.locator("#past-tab").click();
      await tab.locator('#page-list [data-page="newer"]').click();
    },
    ready: shows("#new-15"),
    at: 1500,
  });
});

test("a session with nothing published reloads on a new version too", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const page = await open(t, "about:blank");
  if (!page) return;
  const report = await reportVersion(page);
  await page.goto(`${h.server.origin}${a.base}/`);
  await page.locator("#home-agent:not([hidden])").waitFor();
  await markLoad(page);
  report("another-version");
  assert.equal(await reloads(page), true);
});
