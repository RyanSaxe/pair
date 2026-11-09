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

test("a reply on its page and a card on Work stay unread however long they show, and the window reads nothing in a tab without focus", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  const id = await replied(here, "The answer on the page");
  await propose(here, "deck", "Build the deck");
  await here.request("/api/seen", { cleared: [] });
  const away = await openOn(t, h, here, {}, false);
  if (!away) return;
  await badge(away, 3);
  // The window reads its row on a timer set once it opens, so the clock
  // installed here runs it.
  await away.clock.install();
  await openAll(away);
  assert.match(await selected(away).textContent(), /Build the deck/);
  await shownFrame(away).locator('[data-proposal-card="deck"]').waitFor();
  await away.clock.runFor(3500);
  await agree(away, 3);
  await away.close();

  // With focus, a reply and a card on screen stay unread.
  const page = await open(t, "about:blank");
  if (!page) return;
  await stubPele(page);
  await page.clock.install();
  await page.goto(
    `${h.server.origin}${here.base}/?target=thread-${id}-1#overview`,
  );
  await page.locator(`[id="thread-${id}-1"] .thread-name`).waitFor();
  await badge(page, 3);
  await page.clock.runFor(2500);
  assert.equal(await page.locator("#bell-count").textContent(), "3");
  await page.locator('[data-page="work"]').first().click();
  await page.locator('[data-proposal-card="deck"] .proposal-title').waitFor();
  await page.clock.runFor(2500);
  assert.equal(await page.locator("#bell-count").textContent(), "3");
});

test("a card's Agent replied and its row in the bell leave together when the row is cleared", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await propose(here, "deck", "Build the deck");
  const page = await openOn(t, h, here);
  if (!page) return;
  await page.locator('[data-page="work"]').first().click();
  await page.locator("#work-tab-proposed").click();
  await badge(page, 2);
  await replied(here, "An answer on the card", {
    proposal: "deck",
    round: undefined,
    topic: undefined,
    anchor: undefined,
    target: undefined,
  });
  const state = page.locator("#proposal-deck .card-state");
  await state.filter({ hasText: "Agent replied" }).waitFor(poll);
  await badge(page, 3);
  await page.locator("#bell").click();
  const line = page.locator("#center-list .session-line", {
    hasText: "An answer on the card",
  });
  await line.hover();
  await line.locator(".icon-btn").click();
  await state.filter({ hasText: "Proposed" }).waitFor();
  await badge(page, 2);
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
