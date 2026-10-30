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
async function lines(page) {
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").first().waitFor();
  const titles = await page
    .locator("#center-list .session-row .title")
    .allTextContents();
  await page.keyboard.press("Escape");
  return titles;
}

test("a reply in a thread clears that thread's lines from the bell and keeps the others", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(round())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  await bellReady(page);
  const answered = await thread(session, "page");
  const other = await thread(session, "progress");
  await reply(session, answered);
  await reply(session, answered);
  await reply(session, other);
  await count(page, "3");
  const card = page.locator(`pair-thread[data-thread="${answered}"]`);
  if ((await card.getAttribute("collapsed")) !== null)
    await card.locator(".thread-fold").click();
  await card.locator(".thread-reply textarea").fill("Thanks.");
  await card.locator(".thread-reply button[type=submit]").click();
  await count(page, "1");
  assert.deepEqual(await lines(page), ["Agent replied on Agreed so far"]);
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
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
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
  // Opening the line clears it, so the frame moves the card from Needs you back
  // to Proposed.
  await openLine(page);
  await landed(page, "proposed", reply);
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

test("a session's start and waiting round leave the bell once a tab has shown that session", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const page = await open(t, `${h.server.origin}${a.base}/`);
  if (!page) return;
  await bellReady(page);
  const b = await h.session({ start: true });
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

test("a new session adds a bell line that opens its home view, which loads the round when Agreed publishes", async (t) => {
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
  await count(page, "1");
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").click();
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

test("the Threads tab groups threads by session with no count, and a row opens its thread", async (t) => {
  const h = await hub(t);
  const here = await h.session();
  const other = await h.session();
  assert.equal((await here.publish(round("Retry policy"))).code, 200);
  assert.equal((await other.publish(round("Search index"))).code, 200);
  const waiting = await thread(here, "page");
  const answered = await thread(here, "page");
  await reply(here, answered);
  const elsewhere = await thread(other, "page");

  const page = await open(t, `${h.server.origin}${here.base}/#agreed`);
  if (!page) return;
  await bellReady(page);
  await page.locator("#bell").click();
  const tab = page.getByRole("radio", { name: "Threads" });
  assert.equal(await tab.textContent(), "Threads");
  await tab.click();
  const rows = page.locator("#center-list .session-row");
  await rows.nth(2).waitFor(poll);
  assert.deepEqual(
    await page.locator("#center-list .center-group").allTextContents(),
    ["Retry policy", "Search index"],
  );
  const words = await rows.locator(".words").allTextContents();
  assert.equal(words.length, 3);
  assert.match(words[0], /^Waiting \d+ min · Overview$/);
  assert.ok(words[1].startsWith("Overview · replied"), words[1]);
  assert.match(words[2], /^Waiting \d+ min · Overview$/);
  assert.equal(await page.locator("#center-clear-all").isVisible(), false);

  await page.locator(`#center-list [data-key="thread:${waiting}"]`).click();
  await page.locator("#center-pop").waitFor({ state: "hidden" });
  await page.locator(`pair-thread[data-thread="${waiting}"]`).waitFor();
  assert.equal(new URL(page.url()).hash, "#overview");

  // Another session's row opens that session at the thread.
  await page.locator("#bell").click();
  await page.locator(`#center-list [data-key="thread:${elsewhere}"]`).click();
  await page.waitForURL(`**${other.base}/**`);
  await page.locator(`pair-thread[data-thread="${elsewhere}"]`).waitFor();
});
