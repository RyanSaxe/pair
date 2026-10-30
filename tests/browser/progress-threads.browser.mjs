import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { open } from "../support/browser.mjs";
import { hub, sleep, task } from "../support/hub.mjs";

// The agent publishes each page of a round on its own, so a test can act while
// the round is open.
async function setup(t) {
  const h = await hub(t);
  const session = await h.session();
  const build = (round, page) =>
    buildPage(path.join(session.directory, "source.json"), {
      name: "example",
      round,
      title: "Example work",
      page,
    });
  const pages = [
    { id: "policy", title: "Policy" },
    { id: "flow", title: "Flow" },
  ];
  const publishAgreed = async (round) => {
    const agreed = await build(round, {
      id: "agreed",
      title: "Agreed so far",
      task,
      agreements: [],
    });
    const result = await session.action("publish", { html: agreed, pages });
    assert.equal(result.code, 200, result.body.error);
  };
  const publishPage = async (round, id) => {
    const html = await build(round, {
      id,
      title: pages.find((item) => item.id === id).title,
      html: "<p>The page's text.</p>",
    });
    const result = await session.action("publish", { html });
    assert.equal(result.code, 200, result.body.error);
  };
  const message = async (round, text) => {
    const id = crypto.randomUUID();
    const started = await session.request(`${session.base}/api/threads`, {
      id,
      round,
      topic: "agreed",
      anchor: "Progress",
      target: "agent-activity",
      text,
    });
    assert.equal(started.code, 201, started.body.error);
    return id;
  };
  const reply = async (id, text) => {
    const result = await session.action("reply", { note: id, text });
    assert.equal(result.code, 200, result.body.error);
  };
  // finishFirstRound publishes round 1 and sends its feedback, and the agent
  // reads the feedback.
  const finishFirstRound = async () => {
    await publishAgreed("1");
    await publishPage("1", "policy");
    await publishPage("1", "flow");
    const sent = await session.feedback(session.event("feedback-only", "1"));
    assert.equal(sent.code, 200, JSON.stringify(sent.body));
    assert.equal((await session.action("read")).code, 200);
  };
  const url = `${h.server.origin}${session.base}/#agreed`;
  return { url, finishFirstRound, publishAgreed, publishPage, message, reply };
}
const field = (card) =>
  card.getByRole("textbox", { name: "Reply in this thread" });
// Each of these letters is one of the frame's single-key shortcuts when no text
// field has focus.
const shortcuts = "s a r c n ";
async function assertStillTyping(page, box, text) {
  assert.equal(await box.inputValue(), text);
  assert.equal(
    await page.evaluate(() => document.activeElement.localName),
    "textarea",
  );
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(await page.evaluate(() => location.hash), "#agreed");
}
// previous names the element on screen right above a card.
const previous = (card) =>
  card.evaluate((node) => {
    let at = node.previousElementSibling;
    while (at.hidden) at = at.previousElementSibling;
    return at.id;
  });

test("a progress thread's reply box keeps focus and its card stays open when the agent publishes the last page, and a card not in use collapses", async (t) => {
  const s = await setup(t);
  await s.finishFirstRound();
  await s.publishAgreed("2");
  await s.publishPage("2", "policy");
  const typing = await s.message("2", "Will the flow show half-open?");
  const idle = await s.message("2", "Is the policy final?");
  await s.reply(typing, "Yes.");
  await s.reply(idle, "Yes.");
  const page = await open(t, s.url);
  if (!page) return;
  const card = page.locator(`pair-thread[data-thread="${typing}"]`);
  const other = page.locator(`pair-thread[data-thread="${idle}"]`);
  await card.waitFor();
  await page.locator("#agent-activity").waitFor();
  const box = field(card);
  await box.click();
  await page.keyboard.type(shortcuts);
  await s.publishPage("2", "flow");
  await page.locator("#finished-line").waitFor({ timeout: 5000 });
  await page.keyboard.type(shortcuts);
  await assertStillTyping(page, box, shortcuts + shortcuts);
  assert.equal(await card.getAttribute("collapsed"), null);
  assert.notEqual(await other.getAttribute("collapsed"), null);
  assert.equal(await previous(card), "finished-line");

  // The card stays open after the reviewer leaves the box.
  await page.locator("#page-title").click();
  // The frame polls status every 1.5 s, so the sleep covers two polls.
  await sleep(3000);
  assert.equal(await card.getAttribute("collapsed"), null);
});

test("a message sent while Current waits shows under the progress card, keeps focus when the next round's Agreed arrives, and leaves Last round", async (t) => {
  const s = await setup(t);
  await s.finishFirstRound();
  const page = await open(t, s.url);
  if (!page) return;
  await page.locator("#activity-message").click();
  await page.locator("#note-text").fill("Is the second page first?");
  await page.locator("#note-thread").click();
  const card = page.locator("#reading > pair-thread");
  await card.waitFor();
  assert.equal(await previous(card), "agent-activity");
  const id = await card.getAttribute("data-thread");
  await s.reply(id, "Yes.");
  await card.locator(".thread-message", { hasText: "Yes." }).waitFor();

  const box = field(card);
  await box.click();
  await page.keyboard.type(shortcuts);
  await s.publishAgreed("2");
  await page
    .locator("#page-content", { hasText: "What the plan builds." })
    .waitFor({ timeout: 5000 });
  await page.keyboard.type(shortcuts);
  await assertStillTyping(page, box, shortcuts + shortcuts);
  assert.equal(await card.getAttribute("collapsed"), null);
  assert.equal(await previous(card), "agent-activity");
  await page.locator("#page-title").click();

  await page.locator("#past-tab").click();
  await page.locator('#page-list [data-page="agreed"]').click();
  await page.locator('#past-tab[aria-selected="true"]').waitFor();
  await sleep(500);
  assert.equal(await card.count(), 0);
  await page.locator("#current-tab").click();
  await page.locator('#page-list [data-page="agreed"]').click();
  await card.waitFor();
  assert.equal(await field(card).inputValue(), shortcuts + shortcuts);
});

test("a message sent while Current waits takes the Agreed the round finishes with, collapsed like the round's other progress threads", async (t) => {
  const s = await setup(t);
  await s.finishFirstRound();
  const id = await s.message("1", "Is the second page first?");
  const page = await open(t, s.url);
  if (!page) return;
  const card = page.locator(`pair-thread[data-thread="${id}"]`);
  await card.waitFor();
  assert.equal(await card.getAttribute("collapsed"), null);
  await s.publishAgreed("2");
  await s.publishPage("2", "policy");
  await s.publishPage("2", "flow");
  await page.locator("#finished-line").waitFor({ timeout: 5000 });
  assert.notEqual(await card.getAttribute("collapsed"), null);
  assert.equal(await previous(card), "finished-line");
});
