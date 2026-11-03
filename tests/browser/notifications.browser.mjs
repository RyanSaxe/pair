import assert from "node:assert/strict";
import { test } from "node:test";
import { hub } from "../support/hub.mjs";
import {
  agree,
  badge,
  choice,
  heads,
  menu,
  openAll,
  openOn,
  propose,
  replied,
  reply,
  row,
  selected,
  sessions,
  shownFrame,
  thread,
  typed,
} from "../support/notifications.mjs";

/* The bell's popup and the Notifications window, on a real hub, in the states a
   reviewer meets. agree() runs after every step: the bell's number and the window's
   count come from one list, so they never differ. */

test("the popup lists the newest 5 rows with one row per thread, a link that says how many more, and Clear all", async (t) => {
  const h = await hub(t);
  const { here, other } = await sessions(t, h);
  for (const index of [1, 2, 3, 4, 5, 6, 7])
    await replied(here, `Reply number ${index}`);
  const twice = await replied(other, "First new reply");
  await reply(other, twice, "Second new reply");
  const page = await openOn(t, h, here);
  if (!page) return;
  // 7 threads here, 1 elsewhere with two replies, and the round waiting elsewhere.
  await badge(page, 9);
  await page.locator("#bell").click();
  const rows = page.locator("#center-list .session-row");
  await rows.nth(4).waitFor();
  assert.equal(await rows.count(), 5);
  assert.equal(await page.locator("#center-all").textContent(), "See 4 more");
  assert.deepEqual(await rows.locator(".title").allTextContents(), [
    "Second new reply",
    "Reply number 7",
    "Reply number 6",
    "Reply number 5",
    "Reply number 4",
  ]);
  // A reply's second line has the question that began its thread, the count of
  // new replies, and the session's name for a row from another session.
  assert.deepEqual(await rows.locator(".where").allTextContents(), [
    "“Where does this land?” · 2 replies · Elsewhere",
    "“Where does this land?”",
    "“Where does this land?”",
    "“Where does this land?”",
    "“Where does this land?”",
  ]);
  assert.equal(await page.locator("#center-empty").isVisible(), false);

  await page.locator("#center-clear-all").click();
  await badge(page, 0);
  await page
    .locator("#center-empty", { hasText: "Nothing needs you." })
    .waitFor();
  assert.equal(await page.locator("#center-clear-all").isVisible(), false);
  assert.equal(
    (await page.locator("#center-all").textContent()).trim(),
    "All notifications",
  );
});

test("a row in the popup goes straight to its place and reads it, and a row from another session opens that session there", async (t) => {
  const h = await hub(t);
  const { here, other } = await sessions(t, h);
  const there = await replied(other, "An answer from elsewhere");
  const id = await replied(here, "An answer from here");
  // A reply on screen in a tab with no focus stays unread, so only the click reads it.
  const page = await openOn(t, h, here, {}, false);
  if (!page) return;
  await badge(page, 3);
  await page.locator("#bell").click();
  await page
    .locator("#center-list .session-row", { hasText: "An answer from here" })
    .click();
  await page.locator("#page-title", { hasText: "Overview" }).waitFor();
  await page.locator(`pair-thread[data-thread="${id}"]`).waitFor();
  await badge(page, 2);
  assert.equal(
    await page.locator("#search-dialog").evaluate((box) => box.open),
    false,
  );

  await page.locator("#bell").click();
  await page
    .locator("#center-list .session-row", {
      hasText: "An answer from elsewhere",
    })
    .click();
  await page.waitForURL(`**${other.base}/**`);
  await page.locator(`pair-thread[data-thread="${there}"]`).waitFor();
  // The one row left is the round waiting in Here, because a tab doesn't list its
  // own session's waiting round.
  await badge(page, 1);
});

test("a row in the window reads it at once, and the real page shows it with a working reply box, in another session too", async (t) => {
  const h = await hub(t);
  const { here, other } = await sessions(t, h);
  const id = await replied(other, "An answer from elsewhere");
  await replied(here, "An answer from here");
  const page = await openOn(t, h, here);
  if (!page) return;
  await badge(page, 3);
  await openAll(page);
  await row(page, "An answer from elsewhere").click();
  await agree(page, 2);
  await page.locator(".search-count", { hasText: "2 unread" }).waitFor();
  assert.match(await selected(page).textContent(), /An answer from elsewhere/);
  assert.match(await selected(page).getAttribute("class"), /is-read/);
  // A row just read stays where it was.
  assert.equal((await heads(page))[0], "Unread");
  assert.equal(
    await page
      .locator("#center-pop")
      .evaluate((pop) => pop.matches(":popover-open")),
    false,
  );

  const frame = shownFrame(page);
  const card = frame.locator(`pair-thread[data-thread="${id}"]`);
  await card
    .locator(".thread-message", { hasText: "An answer from elsewhere" })
    .waitFor();
  assert.equal(
    await page.locator(".search-session").textContent(),
    "Elsewhere",
  );
  assert.deepEqual(await page.locator(".search-place span").allTextContents(), [
    "Round 1",
    "Overview",
  ]);

  // The reply reaches the other session's thread, and the row says so at once.
  await card.locator(".thread-reply textarea").fill("Thanks, and on refunds?");
  await card.locator(".thread-reply button[type=submit]").click();
  await selected(page)
    .locator(".search-title", { hasText: "Thanks, and on refunds?" })
    .waitFor();
  assert.match(
    await selected(page).locator(".search-where").textContent(),
    /Not opened · Elsewhere/,
  );
  assert.match(await selected(page).getAttribute("class"), /is-waiting/);
  await agree(page, 2);
  assert.equal(await selected(page).locator(".nt-act").count(), 0);
  await page.waitForFunction(
    async ([origin, session, thread]) => {
      const reply = await fetch(`${origin}/api/notifications`);
      const { sessions } = await reply.json();
      return (
        sessions[session].threads.find((line) => line.thread === thread)
          ?.text === "Thanks, and on refunds?"
      );
    },
    [h.server.origin, other.id, id],
  );
  assert.equal((await heads(page))[0], "Unread");
  await page.keyboard.press("Escape");
  await page.locator("#search-dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.id === "bell");
  await openAll(page);
  await row(page, "Thanks, and on refunds?").waitFor();
  assert.deepEqual(await heads(page), [
    "Unread",
    "Waiting on the agent",
    "Read",
  ]);
});

test("the window shows its first row and reads it once its page stays 3 seconds, and ↓ through the rows reads nothing", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await replied(here, "The first answer");
  const second = await replied(here, "The second answer");
  await thread(here, "A question no one answered");
  const page = await openOn(t, h, here);
  if (!page) return;
  // The first page the pane loads arrives 3.5 seconds late, and the row's 3
  // seconds start only once its page has drawn.
  let slow = true;
  await page.route("**/embed/**", async (route) => {
    if (slow) {
      slow = false;
      await new Promise((done) => setTimeout(done, 3500));
    }
    await route.continue();
  });
  await badge(page, 3);
  await openAll(page);
  assert.match(await selected(page).textContent(), /The second answer/);
  await shownFrame(page)
    .locator(`pair-thread[data-thread="${second}"]`)
    .waitFor();
  await agree(page, 3);
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.className),
    "search-input",
  );
  await badge(page, 2);
  await agree(page, 2);
  assert.match(await selected(page).getAttribute("class"), /is-read/);

  await page.keyboard.press("ArrowDown");
  assert.match(await selected(page).textContent(), /The first answer/);
  await page.waitForTimeout(700);
  // Round 1 waits in the other session, and it's the next row.
  await page.keyboard.press("ArrowDown");
  assert.match(await selected(page).textContent(), /Round 1 is waiting/);
  await agree(page, 2);
  await badge(page, 1);
  await agree(page, 1);
  assert.match(await selected(page).getAttribute("class"), /is-read/);

  // Enter opens the selected row's page, in this tab.
  await page.keyboard.press("ArrowUp");
  assert.match(await selected(page).textContent(), /The first answer/);
  await page.keyboard.press("Enter");
  await page.locator("#search-dialog").waitFor({ state: "hidden" });
  await page.locator("#page-title", { hasText: "Overview" }).waitFor();
  await badge(page, 0);
});

test("a click on the row the window shows by itself opens its page", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await replied(here, "The answer");
  const page = await openOn(t, h, here);
  if (!page) return;
  await badge(page, 2);
  await openAll(page);
  assert.match(await selected(page).textContent(), /The answer/);
  await row(page, "The answer").click();
  await page.locator("#search-dialog").waitFor({ state: "hidden" });
  await page.locator("#page-title", { hasText: "Overview" }).waitFor();
  await badge(page, 1);
});

test("with Unread chosen, a row read by its 3 seconds stays in the list, selected, until a menu changes", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await replied(here, "The first answer");
  await replied(here, "The second answer");
  const page = await openOn(t, h, here);
  if (!page) return;
  await badge(page, 3);
  await openAll(page);
  await menu(page, "states").click();
  await choice(page, "states", "unread").click();
  await page.keyboard.press("Escape");
  assert.match(await selected(page).textContent(), /The second answer/);
  await badge(page, 2);
  const read = row(page, "The second answer");
  assert.match(await read.getAttribute("class"), /is-read/);
  assert.equal(await read.getAttribute("aria-selected"), "true");
  assert.deepEqual(await heads(page), ["Unread"]);

  await menu(page, "states").click();
  await choice(page, "states", "").click();
  await choice(page, "states", "unread").click();
  await read.waitFor({ state: "detached" });
});

test("the menus combine and count, a menu that hides the selected row selects the first row left, and Esc closes a menu before the window", async (t) => {
  const h = await hub(t);
  const { here, other } = await sessions(t, h);
  await replied(here, "A reply here");
  await thread(other, "A question elsewhere");
  await propose(other, "deck", "Build the deck");
  // With no focus, only a click reads a row, however long the window stays open.
  const page = await openOn(t, h, here, {}, false);
  if (!page) return;
  await badge(page, 3);
  await openAll(page);
  await row(page, "A question elsewhere").waitFor();
  assert.deepEqual(await heads(page), [
    "Unread",
    "Waiting on the agent",
    "Read",
  ]);
  assert.equal((await menu(page, "kinds").textContent()).trim(), "All kinds");

  await row(page, "A reply here").click();
  await badge(page, 2);
  await menu(page, "kinds").click();
  assert.equal(
    await choice(page, "kinds", "thread").locator("b").textContent(),
    "2",
  );
  assert.equal(
    await choice(page, "kinds", "proposal").locator("b").textContent(),
    "1",
  );
  await choice(page, "kinds", "proposal").click();
  assert.equal((await menu(page, "kinds").textContent()).trim(), "Proposals");
  await row(page, "Proposal: Build the deck").waitFor();
  assert.equal(await page.locator(".nt-row").count(), 1);
  assert.match(await selected(page).textContent(), /Build the deck/);
  await choice(page, "kinds", "round").click();
  assert.equal((await menu(page, "kinds").textContent()).trim(), "2 kinds");
  await agree(page, 2);

  // Esc closes the menu, and the window stays.
  await page.keyboard.press("Escape");
  await page
    .locator('[data-menu="kinds"] .search-menu')
    .waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#search-dialog").evaluate((box) => box.open),
    true,
  );

  await menu(page, "kinds").click();
  await choice(page, "kinds", "").click();
  await page.keyboard.press("Escape");
  await menu(page, "states").click();
  assert.equal(
    await choice(page, "states", "unread").locator("b").textContent(),
    "2",
  );
  assert.equal(
    await choice(page, "states", "waiting").locator("b").textContent(),
    "1",
  );
  await choice(page, "states", "unread").click();
  assert.deepEqual(await heads(page), ["Unread"]);
  await page.keyboard.press("Escape");

  // Clear all reads the rows, and they stay until a menu changes.
  await page.locator("[data-clear-all]").click();
  await agree(page, 0);
  assert.deepEqual(await heads(page), ["Unread"]);
  assert.equal(await page.locator("[data-clear-all]").count(), 0);
  await menu(page, "states").click();
  await choice(page, "states", "").click();
  await choice(page, "states", "unread").click();
  await page.locator(".search-blank", { hasText: "Nothing unread." }).waitFor();
  await choice(page, "states", "unread").click();
  await choice(page, "states", "waiting").click();
  await choice(page, "states", "read").click();
  assert.equal((await menu(page, "states").textContent()).trim(), "2 states");
  await page.keyboard.press("Escape");
  await menu(page, "sessions").click();
  await choice(page, "sessions", "here").click();
  assert.equal(
    (await menu(page, "sessions").textContent()).trim(),
    "This session",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator("#search-dialog").waitFor({ state: "hidden" });

  // Each open starts clean.
  await openAll(page);
  assert.equal(
    (await menu(page, "sessions").textContent()).trim(),
    "All sessions",
  );
  assert.equal((await menu(page, "states").textContent()).trim(), "All states");
  assert.equal(await page.inputValue(".search-input"), "");
});

test("✕ in the popup and in the window clears a row, a read row offers nothing, and a click outside closes the window", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await replied(here, "The first answer");
  await replied(here, "The second answer");
  const page = await openOn(t, h, here, {}, false);
  if (!page) return;
  await badge(page, 3);
  await page.locator("#bell").click();
  const line = page.locator("#center-list .session-line", {
    hasText: "The second answer",
  });
  await line.hover();
  await line.locator(".icon-btn").click();
  await badge(page, 2);
  await page.keyboard.press("Escape");
  await openAll(page);
  await agree(page, 2);
  const first = row(page, "The first answer");
  await first.hover();
  await first.locator(".nt-act").click();
  await agree(page, 1);
  // It stays where it was, read and still selected, with no ✕.
  assert.match(await first.getAttribute("class"), /is-read/);
  assert.match(await selected(page).textContent(), /The first answer/);
  await first.hover();
  assert.equal(await first.locator(".nt-act").count(), 0);
  assert.equal((await heads(page))[0], "Unread");

  await page.mouse.click(4, 4);
  await page.locator("#search-dialog").waitFor({ state: "hidden" });
  await openAll(page);
  await page
    .locator(".nt-row.is-read", { hasText: "The first answer" })
    .waitFor();
  assert.deepEqual(await heads(page), ["Unread", "Read"]);
});

test("the field searches every message, a typo too, and a row keeps its group and shows the match under it, with the page marking the words", async (t) => {
  const h = await hub(t);
  const { here, other } = await sessions(t, h);
  const deep = await thread(here, "What holds the first answer?");
  await reply(
    here,
    deep,
    `${"Words before it. ".repeat(20)}The kestrel holds it.`,
  );
  await reply(here, deep, "The newest answer here.");
  await replied(other, "Nothing about birds.");
  const page = await openOn(t, h, here);
  if (!page) return;
  await badge(page, 3);
  await openAll(page);
  await page.locator("[data-clear-all]").click();
  await agree(page, 0);
  await page.keyboard.press("Escape");
  await page.locator("#search-dialog").waitFor({ state: "hidden" });
  await openAll(page);

  // A key typed anywhere goes to the field.
  await typed(page, "kestr", () => page.keyboard.type("kestr"));
  assert.equal(await page.inputValue(".search-input"), "kestr");
  const found = row(page, "The newest answer here.");
  await found.waitFor();
  assert.equal(await page.locator(".nt-row").count(), 1);
  assert.deepEqual(await heads(page), ["Read"]);
  await found
    .locator(".search-snippet mark", { hasText: "kestr" })
    .first()
    .waitFor();

  // The window shows the top result with no click.
  await shownFrame(page)
    .locator(`pair-thread[data-thread="${deep}"]`)
    .waitFor();
  // A typo finds the word, and the window stays on the row.
  await typed(page, "kestrl", () => page.fill(".search-input", "kestrl"));
  await found.locator(".search-snippet mark").first().waitFor();
  assert.match(
    await found.locator(".search-snippet mark").first().textContent(),
    /^kestr/i,
  );
  assert.equal(await selected(page).count(), 1);
  await page.waitForFunction(() => {
    const win = document.querySelector(".search-frame.is-shown")?.contentWindow;
    return win?.CSS.highlights?.get("plan-search")?.size > 0;
  });

  // The frame matches a row's own words, its page and its session's title.
  await typed(page, "elsewhere", () => page.fill(".search-input", "elsewhere"));
  await row(page, "Nothing about birds.").waitFor();
  await page
    .locator(".nt-row", { hasText: "Round 1 is waiting for you" })
    .waitFor();

  await agree(page, 0);
  await typed(page, "zzzqqq", () => page.fill(".search-input", "zzzqqq"));
  const blank = page.locator(".search-blank");
  await blank
    .locator("span", { hasText: "No notifications match “zzzqqq”." })
    .waitFor();
  await blank
    .getByRole("button", { name: "Search all of pair for “zzzqqq”" })
    .click();
  await page.locator("#search-dialog[data-source=Search]").waitFor();
  assert.equal(await page.inputValue(".search-input"), "zzzqqq");
  assert.equal(
    await page.locator("#search-dialog").getAttribute("aria-label"),
    "Search",
  );
  await page.keyboard.press("Escape");
  await page.locator("#search-dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.activeElement?.id === "search-button",
  );
});

test("⌘K in Notifications opens Search with the typed words, and with none it opens Search as it was", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  const page = await openOn(t, h, here);
  if (!page) return;
  await openAll(page);
  await page.keyboard.type("walrus");
  await page.keyboard.press("Meta+k");
  await page.locator("#search-dialog[data-source=Search]").waitFor();
  assert.equal(await page.inputValue(".search-input"), "walrus");
  assert.equal(
    (
      await page
        .locator('[data-menu="sessions"] .search-menu-button')
        .textContent()
    ).trim(),
    "All + closed",
  );
  await page.keyboard.press("Escape");
  await page.locator("#search-dialog").waitFor({ state: "hidden" });
  await openAll(page);
  assert.equal(
    await page.locator("#search-dialog").getAttribute("aria-label"),
    "Notifications",
  );
  await page.keyboard.press("Meta+k");
  await page.locator("#search-dialog[data-source=Search]").waitFor();
  assert.equal(await page.inputValue(".search-input"), "walrus");
});

test("a card's row opens the card on its Work tab, says Waiting for Start until it's decided, and Open lands there in this tab", async (t) => {
  const h = await hub(t);
  const { here } = await sessions(t, h);
  await propose(here, "running", "Already running");
  const started = await here.request(
    `${here.base}/api/proposals/running/start`,
    { where: "here" },
  );
  assert.equal(started.code, 200, started.body.error);
  await propose(here, "deck", "Build the deck");
  const page = await openOn(t, h, here);
  if (!page) return;
  await badge(page, 2);
  await openAll(page);
  assert.match(await selected(page).textContent(), /Build the deck/);
  const frame = shownFrame(page);
  await frame.locator('#work-tab-proposed[aria-selected="true"]').waitFor();
  await frame.locator('[data-proposal-card="deck"]').waitFor();
  await badge(page, 1);
  await agree(page, 1);
  assert.match(
    await selected(page).locator(".search-where").textContent(),
    /^Waiting for Start · Here/,
  );
  assert.match(await selected(page).getAttribute("class"), /is-read/);

  // The real Start opens its dialog in the frame, and the row then has the card's word.
  await frame.locator('[data-proposal-card="deck"] .proposal-start').click();
  await frame.locator("#start-dialog[open]").waitFor();
  await frame.locator("#start-dialog .btn.primary:visible").first().click();
  await frame.locator("#start-dialog").waitFor({ state: "hidden" });
  await selected(page)
    .locator(".search-where", { hasText: /Working here|Opening/ })
    .waitFor();

  // This tab reads the card's new state from its next status poll.
  await page.waitForResponse(/\/api\/status$/);
  await page.locator(".search-open").click();
  await page.locator("#search-dialog").waitFor({ state: "hidden" });
  await page.locator('#work-tab-running[aria-selected="true"]').waitFor();
  await page.locator('[data-proposal-card="deck"]').waitFor();
});
