import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
const scroller = `[document.querySelector("main"), document.querySelector(".app-body")].find((el) => /auto|scroll/.test(getComputedStyle(el).overflowY))`;
const cardAt = (id) => `#work-cards [data-proposal-card=${id}]`;

// workPage records the six cards, starts them when started is set, and opens
// Work on the tab that lists them.
async function workPage(t, { started = false, ...options } = {}) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const send = async (fields) => {
    const result = await session.action("propose", fields);
    assert.equal(result.code, 200, result.body.error);
  };
  for (const id of names) {
    await send({
      id,
      title: `Build ${id}`,
      delivers: `What ${id} delivers. `.repeat(12),
      recommend: "here",
    });
    if (started) await send({ id, start: "here", quote: "Build it." });
  }
  const page = await open(
    t,
    `${h.server.origin}${session.base}/#work`,
    options,
  );
  if (!page) return {};
  const tabId = started ? "running" : "proposed";
  if (started) await page.locator("#work-tab-running").click();
  await page.locator(cardAt(names.at(-1))).waitFor({ timeout: 8000 });
  return { session, page, send, tabId };
}
const placeAt = (page, id, pixels) =>
  page.evaluate(
    ([card, pixels, scroller]) => {
      const box = eval(scroller);
      box.scrollTop +=
        document.querySelector(card).getBoundingClientRect().top -
        box.getBoundingClientRect().top -
        pixels;
    },
    [cardAt(id), pixels, scroller],
  );
// watchCard records the card's top at every frame, so a jump that lasts one
// frame counts.
const watchCard = (page, id) =>
  page.evaluate((card) => {
    window.tops = [];
    const frame = () => {
      window.tops.push(
        document.querySelector(card)?.getBoundingClientRect().top ?? null,
      );
      requestAnimationFrame(frame);
    };
    frame();
  }, cardAt(id));
// assertHeld reads the tops since the last change and starts the next list, so
// each change is held to 1px and a browser's rounding does not add up.
const assertHeld = async (page, what) => {
  const tops = await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(window.tops.splice(0, Infinity))),
        ),
      ),
  );
  assert.ok(
    tops.every((top) => top !== null),
    `the card left the list when ${what}`,
  );
  const moved = Math.max(...tops) - Math.min(...tops);
  assert.ok(moved <= 1, `the card moved ${moved}px when ${what}`);
};
const count = (page, id, value) =>
  page
    .locator(`#work-tab-${id} .work-count`, {
      hasText: new RegExp(`^${value}$`),
    })
    .waitFor({ timeout: 8000 });
const listed = (page) =>
  page
    .locator("#work-cards > [data-proposal-card]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.proposalCard));

for (const { width, height, engine } of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
  { width: 375, height: 812, engine: "webkit" },
])
  test(`the card on screen holds still while other cards change, and stays when it changes tab, at ${width}px in ${engine === "webkit" ? "WebKit" : "Chrome"}`, async (t) => {
    const { session, page, send } = await workPage(t, {
      started: true,
      engine,
      viewport: { width, height },
    });
    if (!page) return;
    await send({ id: "delta", statusLeft: ["One"] });
    await page
      .locator(`${cardAt("delta")} .proposal-status summary`)
      .waitFor({ timeout: 8000 });
    await placeAt(page, "delta", 60);
    await watchCard(page, "delta");

    await send({ id: "alpha", done: true });
    await count(page, "running", 5);
    await assertHeld(page, "a card above finished");
    assert.equal((await listed(page)).includes("alpha"), false);

    const thread = crypto.randomUUID();
    const started = await session.request(`${session.base}/api/threads`, {
      id: thread,
      proposal: "bravo",
      text: "Which one?",
    });
    assert.equal(started.code, 201, started.body.error);
    const replied = await session.action("reply", {
      note: thread,
      text: "This one.\n".repeat(6),
    });
    assert.equal(replied.code, 200, replied.body.error);
    await page
      .locator(`pair-thread[data-thread="${thread}"] .thread-message`, {
        hasText: "This one.",
      })
      .waitFor({ state: "attached", timeout: 8000 });
    await assertHeld(page, "the agent replied on a card above");

    await send({ id: "charlie", statusLeft: ["One", "Two", "Three"] });
    await page
      .locator(`${cardAt("charlie")} .proposal-status summary`)
      .waitFor({ state: "attached", timeout: 8000 });
    await assertHeld(page, "the agent added parts to a card above");

    await send({ id: "delta", done: true });
    await page
      .locator(`${cardAt("delta")} .card-state`, { hasText: "Done" })
      .waitFor({ timeout: 8000 });
    await count(page, "running", 4);
    await assertHeld(page, "the card itself finished");
    assert.equal((await listed(page)).length, 5);

    await page.locator("#work-tab-done").click();
    await page.locator("#work-tab-running").click();
    assert.deepEqual(await listed(page), [
      "bravo",
      "charlie",
      "echo",
      "foxtrot",
    ]);
  });

test("the card under a card that grows holds still", async (t) => {
  const { page, send } = await workPage(t, {
    started: true,
    viewport: { width: 1280, height: 800 },
  });
  if (!page) return;
  await placeAt(page, "charlie", 40);
  await watchCard(page, "delta");
  await send({ id: "charlie", statusLeft: ["One", "Two", "Three"] });
  await page
    .locator(`${cardAt("charlie")} .proposal-status summary`)
    .waitFor({ timeout: 8000 });
  await assertHeld(page, "the card above it on screen grew");
});

test("the end of the page does not pull the card up when the card under it gets shorter", async (t) => {
  const { page, send } = await workPage(t, {
    viewport: { width: 1280, height: 620 },
  });
  if (!page) return;
  await page.evaluate((scroller) => {
    const box = eval(scroller);
    box.scrollTop = box.scrollHeight;
  }, scroller);
  await watchCard(page, "echo");
  // A card done elsewhere loses its row of buttons, so the page gets shorter
  // and the reader is at its end.
  await send({ id: "foxtrot", done: true, where: "in #86" });
  await page
    .locator(`${cardAt("foxtrot")} .card-state`, { hasText: "Done" })
    .waitFor({ timeout: 8000 });
  await assertHeld(page, "the card under it lost its buttons");
});
