import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// Overview contains a block so that a test can start a page thread on it.
const round = (title = "Example work") => ({
  ...planData(),
  title,
  pages: [
    {
      id: "overview",
      title: "Overview",
      html: '<p id="result">Preserve one result per input.</p>',
    },
  ],
});
const kinds = {
  page: { topic: "overview", anchor: "Result line", target: "result" },
  progress: { topic: "agreed", anchor: "Progress", target: "agent-activity" },
};
const thread = async (session, kind) => {
  const id = crypto.randomUUID();
  const started = await session.request(`${session.base}/api/threads`, {
    id,
    round: "1",
    text: "Where does this land?",
    ...kinds[kind],
  });
  assert.equal(started.code, 201, JSON.stringify(started.body));
  return id;
};
const reply = async (session, id) =>
  assert.equal(
    (await session.action("reply", { note: id, text: "Here." })).code,
    200,
  );
// The frame polls the session list every 5 s, so each wait allows 8 s.
const poll = { timeout: 8000 };
const count = (page, text) =>
  page.locator("#bell-count", { hasText: new RegExp(`^${text}$`) }).waitFor({
    ...poll,
    state: text ? "visible" : "hidden",
  });
// The frame marks every event it finds at the bell's first load as seen, so
// each test waits for the bell to show before it adds an event.
const bellReady = (page) => page.locator("#bell").waitFor();
// A reply on screen in a tab with focus is read after 1.5 s, so a test that counts
// the replies on the page it shows opens it with no focus.
async function openUnfocused(t, url) {
  const page = await open(t, "about:blank");
  if (!page) return null;
  await page.addInitScript(() => {
    document.hasFocus = () => false;
  });
  await page.goto(url);
  return page;
}
async function lines(page) {
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").first().waitFor();
  const titles = await page
    .locator("#center-list .session-row .title")
    .allTextContents();
  await page.keyboard.press("Escape");
  return titles;
}

test("a reply in a thread clears that thread's row from the bell and keeps the others", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(round())).code, 200);
  const page = await openUnfocused(
    t,
    `${h.server.origin}${session.base}/#overview`,
  );
  if (!page) return;
  await bellReady(page);
  const answered = await thread(session, "page");
  const other = await thread(session, "progress");
  await reply(session, answered);
  await reply(session, answered);
  await reply(session, other);
  await count(page, "2");
  const card = page.locator(`pair-thread[data-thread="${answered}"]`);
  if ((await card.getAttribute("collapsed")) !== null)
    await card.locator(".thread-fold").click();
  await card.locator(".thread-reply textarea").fill("Thanks.");
  await card.locator(".thread-reply button[type=submit]").click();
  await count(page, "1");
  assert.deepEqual(await lines(page), ["Here."]);
  // After a reload, the frame must still count only the reply on the other
  // thread.
  await page.reload();
  await bellReady(page);
  await count(page, "1");
});

test("a thumbs up on a reply fills and takes its line out of the bell, and pressing it again puts both back", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(round())).code, 200);
  const page = await openUnfocused(
    t,
    `${h.server.origin}${session.base}/#overview`,
  );
  if (!page) return;
  await bellReady(page);
  const id = await thread(session, "page");
  await reply(session, id);
  await count(page, "1");
  const thumb = page.locator(`pair-thread[data-thread="${id}"] .thread-ack`);
  await thumb.click();
  assert.equal(await thumb.getAttribute("aria-pressed"), "true");
  await count(page, "");
  await page.reload();
  await page
    .locator(
      `pair-thread[data-thread="${id}"] .thread-ack[aria-pressed="true"]`,
    )
    .waitFor();
  await count(page, "");
  await thumb.click();
  assert.equal(await thumb.getAttribute("aria-pressed"), "false");
  await count(page, "1");
});

// Build the deck runs here and Refresh the export is proposed, so the frame
// opens Work on Running unless the reviewer opens a bell line for another card.
async function workSession(h) {
  const session = await h.session();
  assert.equal((await session.publish(round())).code, 200);
  for (const [id, title] of [
    ["deck", "Build the deck"],
    ["export", "Refresh the export"],
  ]) {
    const added = await session.action("propose", {
      id,
      title,
      delivers: `${title}, delivered.`,
      recommend: "here",
    });
    assert.equal(added.code, 200, added.body.error);
  }
  const started = await session.request(
    `${session.base}/api/proposals/deck/start`,
    { where: "here" },
  );
  assert.equal(started.code, 200, started.body.error);
  return session;
}
// cardReply returns the element ID of the agent's reply, which is the bell
// line's target.
async function cardReply(session, proposal) {
  const id = crypto.randomUUID();
  const started = await session.request(`${session.base}/api/threads`, {
    id,
    proposal,
    text: "Which export?",
  });
  assert.equal(started.code, 201, JSON.stringify(started.body));
  await reply(session, id);
  return `thread-${id}-1`;
}
async function openLine(page) {
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").click();
  await page.locator(".search-open").click();
}
const landed = async (page, tab, id) => {
  await page.locator(`#work-tab-${tab}[aria-selected="true"]`).waitFor();
  await page.locator(`#work-view [id="${id}"]:focus`).waitFor();
};

test("a line on a card opens Work on the card's tab at the reply or the card it names", async (t) => {
  const h = await hub(t);
  const session = await workSession(h);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  await bellReady(page);
  const reply = await cardReply(session, "export");
  await count(page, "1");
  await openLine(page);
  await landed(page, "proposed", reply);
  // The card the line opened at stays on the tab when it finishes.
  const finished = await session.action("propose", {
    id: "export",
    done: true,
    where: "in #86",
  });
  assert.equal(finished.code, 200, finished.body.error);
  await page
    .locator("[data-proposal-card=export] .card-state", { hasText: "Done" })
    .waitFor();
  await page.locator('#work-tab-proposed[aria-selected="true"]').waitFor();
  await page.locator("#work-tab-running").click();
  const added = await session.action("propose", {
    id: "chart",
    title: "Draw the chart",
    delivers: "The chart, drawn.",
    recommend: "here",
  });
  assert.equal(added.code, 200, added.body.error);
  await count(page, "1");
  await openLine(page);
  await landed(page, "proposed", "proposal-chart");
});

test("a line on a card in another session opens Work there at the reply, while that session's round waits", async (t) => {
  const h = await hub(t);
  const other = await workSession(h);
  assert.equal((await other.feedback(other.event())).code, 200);
  const session = await h.session();
  assert.equal((await session.publish(round("Session A"))).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  await bellReady(page);
  const reply = await cardReply(other, "export");
  await count(page, "1");
  await openLine(page);
  await page.waitForURL((url) => url.pathname === `${other.base}/`);
  await landed(page, "proposed", reply);
});

test("another session's finished round adds a waiting line, and sending that round removes it", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const b = await h.session();
  assert.equal((await a.publish(round())).code, 200);
  const page = await open(t, `${h.server.origin}${a.base}/`);
  if (!page) return;
  await bellReady(page);
  assert.equal((await b.publish(round("Session B"))).code, 200);
  await count(page, "1");
  assert.equal((await b.feedback(b.event())).code, 200);
  await count(page, "");
});

test("a session's waiting round leaves the bell once a tab has shown that session", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const page = await open(t, `${h.server.origin}${a.base}/`);
  if (!page) return;
  await bellReady(page);
  const b = await h.session({ start: true });
  assert.equal((await b.publish(round("Session B"))).code, 200);
  await count(page, "1");
  assert.equal((await a.publish(round())).code, 200);
  await page.locator("#page-title", { hasText: "Agreed so far" }).waitFor();
  await bellReady(page);
  // The test switches sessions from the session list, because opening a bell
  // line would clear that line.
  const switchTo = async (session) => {
    await page.locator("#menu-button").click();
    await page.locator(`[data-key="open:${session.id}"]`).click();
    await page.waitForURL(`${h.server.origin}${session.base}/`);
    await bellReady(page);
    return page.locator("#bell").getAttribute("aria-label");
  };
  assert.equal(await switchTo(b), "Notifications");
  assert.equal(await switchTo(a), "Notifications");
});

// A window beside the one the reviewer uses is on screen without focus. Headless
// Chrome reports every page as visible and focused, so the test makes the tab
// report no focus until it sets it.
test("a session on screen in a window without focus keeps its waiting round in the other tabs' bells until that window has focus", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const b = await h.session();
  const blank = await open(t, "about:blank");
  if (!blank) return;
  // Two tabs of one browser share storage only in a context made with
  // newContext().
  const context = await blank.context().browser().newContext();
  const page = await context.newPage();
  await page.goto(`${h.server.origin}${a.base}/`);
  await bellReady(page);
  const beside = await context.newPage();
  await beside.addInitScript(() => {
    let focused = false;
    document.hasFocus = () => focused;
    window.setFocused = (next) => (focused = next);
  });
  await beside.goto(`${h.server.origin}${b.base}/`);
  await bellReady(beside);

  assert.equal((await b.publish(round("Session B"))).code, 200);
  const { sessions, seen } = (await b.request("/api/sessions")).body;
  const line = sessions
    .find(({ id }) => id === b.id)
    .events.find(({ kind }) => kind === "waiting");
  assert.equal(seen.cleared?.includes(line.id) ?? false, false);
  await count(page, "1");
  // Each session list that this tab reads after the publish would clear the
  // line if the tab counted as seen, and the frame reads one every 5 s.
  const listed = () => beside.waitForResponse(/\/api\/sessions$/, poll);
  await listed();
  await listed();
  await count(page, "1");
  const after = (await b.request("/api/sessions")).body.seen.cleared;
  assert.equal(after?.includes(line.id) ?? false, false);

  await beside.evaluate(() => window.setFocused(true));
  await count(page, "");
});

test("a new session adds no bell line, and its row in Notifications opens its home view, which loads the round when Agreed publishes", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(round())).code, 200);
  const errors = [];
  const page = await open(t, `${h.server.origin}${a.base}/`);
  if (!page) return;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await bellReady(page);
  const c = await h.session({ start: true });
  await page.locator("#bell").click();
  await page.locator("#center-all").click();
  const row = page.locator(".nt-row", {
    hasText: "Claude Code started a session",
  });
  await row.first().waitFor(poll);
  await count(page, "");
  await row.first().click();
  await page.locator(".search-open").click();
  await page.waitForURL(`${h.server.origin}${c.base}/`);
  await page.locator("#home-agent", { hasText: "Claude Code" }).waitFor();
  await page.getByRole("button", { name: "Agreed so far, queued" }).waitFor();
  assert.equal(await page.locator("#round").isDisabled(), true);
  for (const key of ["]", "a", "j", "c", "r"]) await page.keyboard.press(key);
  assert.equal(new URL(page.url()).hash, "");
  assert.equal((await c.publish(round("Session C"))).code, 200);
  await page.locator("#page-title", { hasText: "Agreed so far" }).waitFor();
  assert.deepEqual(errors, []);
});
