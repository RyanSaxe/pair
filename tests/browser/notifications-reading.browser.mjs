import assert from "node:assert/strict";
import { test } from "node:test";
import { launch, open, stubPele } from "../support/browser.mjs";
import { hub } from "../support/hub.mjs";
import {
  agree,
  badge,
  heads,
  openAll,
  openOn,
  poll,
  propose,
  replied,
  reply,
  row,
  selected,
  sessions,
  shownFrame,
  thread,
} from "../support/notifications.mjs";

/* How a row gets read away from the window, on another browser and on the page,
   and a row on the overall comment. */

test("a read on one browser reaches another within one poll, and both counts stay equal", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await replied(here, "The answer");
  const browser = await launch().catch(() => null);
  if (!browser) return t.skip("Chrome for Testing is not installed");
  t.after(() => browser.close());
  // Neither tab has focus, so only ✕ reads the row.
  const start = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await stubPele(page);
    await page.addInitScript(() => {
      document.hasFocus = () => false;
    });
    await page.goto(`${h.server.origin}${here.base}/#second`);
    await page.locator("#bell").waitFor();
    return page;
  };
  const computer = await start();
  const phone = await start();
  await badge(computer, 2);
  await badge(phone, 2);
  await openAll(computer);
  await openAll(phone);
  await row(phone, "The answer").waitFor();
  await agree(phone, 2);
  const { sessions: answered } = await (
    await fetch(`${h.server.origin}/api/sessions`)
  ).json();
  assert.ok(answered.length);

  const answer = row(computer, "The answer");
  await answer.hover();
  await answer.locator(".nt-act").click();
  await agree(computer, 1);
  // Five seconds is the poll, and the mark goes with the number.
  await badge(phone, 1);
  await agree(phone, 1);
  await phone.locator(".nt-row.is-read", { hasText: "The answer" }).waitFor();
  assert.equal((await heads(phone))[0], "Unread");
});

test("a reply is read once it stays whole on screen for 1.5 seconds in a tab with focus, not in the window of a tab without focus, and not while the window covers it", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  const id = await replied(here, "The answer on the page");
  await here.request("/api/seen", { cleared: [] });
  const away = await openOn(t, h, here, {}, false);
  if (!away) return;
  await badge(away, 2);
  await away.goto(
    `${h.server.origin}${here.base}/?target=thread-${id}-1#overview`,
  );
  const line = away.locator(`[id="thread-${id}-1"] .thread-name`);
  await line.waitFor();
  // With no focus, the reply stays unread, on the page and in the window's pane.
  await away.waitForTimeout(2200);
  await badge(away, 2);
  await openAll(away);
  assert.match(await selected(away).textContent(), /The answer on the page/);
  await shownFrame(away).locator(`pair-thread[data-thread="${id}"]`).waitFor();
  await away.waitForTimeout(3500);
  await agree(away, 2);
  await away.close();

  const page = await open(t, "about:blank");
  if (!page) return;
  await stubPele(page);
  await page.goto(`${h.server.origin}${here.base}/#second`);
  await page.locator("#bell").waitFor();
  await badge(page, 2);
  // The window opens over the page, and the reply behind it stays unread.
  await openAll(page);
  await agree(page, 2);
  await page.keyboard.press("Escape");
  await page.locator(`[data-page="overview"]`).first().click();
  await page
    .locator(`[id="thread-${id}-1"] .thread-name`)
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const count = await page.locator("#bell-count").textContent();
  assert.equal(count, "2");
  await badge(page, 1);
});

test("a card's Agent replied and its row in the bell leave together, once the reply stays on screen", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await propose(here, "deck", "Build the deck");
  const page = await openOn(t, h, here);
  if (!page) return;
  await page.locator('[data-page="work"]').first().click();
  await page.locator("#work-tab-proposed").click();
  await badge(page, 1);
  const id = await replied(here, "An answer on the card", {
    proposal: "deck",
    round: undefined,
    topic: undefined,
    anchor: undefined,
    target: undefined,
  });
  const state = page.locator("#proposal-deck .card-state");
  await state.filter({ hasText: "Agent replied" }).waitFor(poll);
  await badge(page, 2);
  await page.locator(`[id="thread-${id}-1"] .thread-name`).waitFor();
  await state.filter({ hasText: "Proposed" }).waitFor();
  await badge(page, 1);
});

test("a proposal is read once its card's title stays on screen on Work", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await propose(here, "deck", "Build the deck");
  const page = await openOn(t, h, here);
  if (!page) return;
  await badge(page, 2);
  await page.locator('[data-page="work"]').first().click();
  await page.locator('[data-proposal-card="deck"] .proposal-title').waitFor();
  assert.equal(await page.locator("#bell-count").textContent(), "2");
  await badge(page, 1);
});

test("a thread on the overall comment shows in the pane without waiting", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  const id = await thread(here, "On the whole round", {
    topic: "overall",
    anchor: "Overall feedback",
    target: undefined,
  });
  await reply(here, id, "An answer on the whole round.");
  const page = await openOn(t, h, here);
  if (!page) return;
  const started = Date.now();
  await openAll(page);
  assert.match(
    await selected(page).textContent(),
    /An answer on the whole round\./,
  );
  await shownFrame(page)
    .locator(`pair-thread[data-thread="${id}"]`)
    .waitFor({ timeout: 5000 });
  assert.ok(Date.now() - started < 5000);
});
