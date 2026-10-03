import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep } from "../support/hub.mjs";

// A round whose Overview has a block a page thread can target.
const round = (number) => ({
  ...planData(number),
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

async function setup(t) {
  const h = await hub(t);
  const session = await h.session();
  const url = (rest) => `${h.server.origin}${session.base}/${rest}`;
  const publish = async (number) =>
    assert.equal((await session.publish(round(number))).code, 200);
  // The agent reads each submission, as it would before the next round.
  const send = async (number) => {
    const sent = await session.feedback(session.event("feedback-only", number));
    assert.equal(sent.code, 200, JSON.stringify(sent.body));
    for (const step of ["ack", "read"])
      assert.equal((await session.action(step)).code, 200);
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
  // The agent's first reply is the thread's row 1.
  const reply = async (id) =>
    assert.equal(
      (await session.action("reply", { note: id, text: "Here." })).code,
      200,
    );
  return { url, publish, send, thread, reply };
}

const focused = (page, id) =>
  page.waitForFunction(
    (row) => document.activeElement?.id === row,
    `thread-${id}-1`,
    { timeout: 5000 },
  );
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

test("a reply in the round just sent opens under Previous", async (t) => {
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
  await page.locator("#past-tab", { hasText: "Round 1" }).waitFor();
  await title(page, "Overview");
  await focused(page, onPage);
  await s.reply(onProgress);
  await page.goto(s.url(`?target=thread-${onProgress}-1#agreed`));
  await selected(page, "past");
  await title(page, "Agreed so far");
  await focused(page, onProgress);
});

test("a reply in an older round opens under Previous, not /r/", async (t) => {
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
  await page.locator("#feedback").waitFor();
  await s.send("1");
  const waiting = async () => {
    await page.locator("#reading").waitFor();
    assert.equal(await page.evaluate(() => location.hash), "#agreed");
    assert.equal(await page.locator("#feedback").isVisible(), false);
  };
  await page.goto(s.url("r/1"));
  await page.locator("#history-return").click();
  await page.waitForURL(/\/s\/[^/]+\/(#.*)?$/);
  await waiting();
  await page.goto(s.url("#feedback"));
  await waiting();
});
