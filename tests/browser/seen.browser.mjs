import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

// The frame in each tab polls the session list every 5 s, so each wait allows 8
// s.
const poll = { timeout: 8000 };

// Two browser contexts with separate storage stand for a computer and a phone
// on one hub. The hub stores what the reviewer clears, opens and sees in one
// browser, and the frame in the other browser must read it from the hub.
test("two browsers on one hub show the same bell, sessions badge and New marks", async (t) => {
  const h = await hub(t);
  const own = await h.session();
  const data = planData();
  data.pages[0].html +=
    '<div class="proposal" data-proposal="tidy" data-kind="proposal"><p><b>Tidy</b></p><p>Tidy work.</p></div>';
  assert.equal((await own.publish(data)).code, 200);
  const proposed = await own.action("propose", {
    id: "tidy",
    title: "Tidy the list",
    delivers: "The list, tidied.",
    recommend: "here",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const other = await h.session();
  assert.equal(
    (await other.publish({ ...planData(), title: "Other work" })).code,
    200,
  );
  // The test gives the hub an empty seen record, so the frame in neither
  // browser counts what the hub lists as already seen.
  const empty = { cleared: [], opened: [], cards: [] };
  assert.equal((await own.request("/api/seen", empty)).code, 200);

  const url = `${h.server.origin}${own.base}/`;
  const computer = await open(t, url);
  if (!computer) return;
  const phone = await open(t, url, { viewport: { width: 375, height: 812 } });
  const both = [computer, phone];
  const bellCount = (page) => page.locator("#bell-count").textContent();
  const pageNew = (page) =>
    page.locator('#page-list [data-page="overview"] .page-new');
  for (const page of both) {
    await page.locator("#bell-count").waitFor(poll);
    await page.locator("#menu-button.need").waitFor(poll);
    await pageNew(page).waitFor({ ...poll, state: "attached" });
  }
  assert.equal(await bellCount(phone), await bellCount(computer));

  await computer.locator("#bell").click();
  await computer.locator("#center-clear-all").click();
  await phone.locator("#bell-count").waitFor({ ...poll, state: "hidden" });
  await phone.locator("#menu-button:not(.need)").waitFor(poll);

  await computer.keyboard.press("Escape");
  await computer.locator('#page-list [data-page="overview"]').click();
  await pageNew(phone).waitFor({ ...poll, state: "detached" });

  await phone.goto(`${url}#overview`);
  const label = phone.locator(
    "#page-content [data-proposal-card=tidy] .page-new",
  );
  await label.waitFor(poll);
  await computer.locator("#work-row").click();
  await computer.locator("#work-cards [data-proposal-card=tidy]").waitFor();
  await label.waitFor({ ...poll, state: "detached" });
});

// Headless Chrome reports every tab as visible, so the test makes the page
// report hidden and sends the event that a tab switch sends.
test("a hidden tab leaves a new round's Agreed unopened until the reviewer comes back to the tab", async (t) => {
  const h = await hub(t);
  const own = await h.session();
  assert.equal((await own.publish(planData())).code, 200);
  const empty = { cleared: [], opened: [], cards: [] };
  assert.equal((await own.request("/api/seen", empty)).code, 200);
  const page = await open(t, "about:blank");
  if (!page) return;
  await page.addInitScript(() => {
    let visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      get: () => visibility,
    });
    window.setVisibility = (next) => {
      visibility = next;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
  await page.goto(`${h.server.origin}${own.base}/`);
  assert.equal((await own.feedback(own.event())).code, 200);
  await page.locator("#agent-activity:not([hidden])").waitFor(poll);
  await page.evaluate(() => window.setVisibility("hidden"));

  assert.equal((await own.action("read")).code, 200);
  assert.equal((await own.publish(planData("2"))).code, 200);
  const opened = async () =>
    (await own.request("/api/sessions")).body.seen.opened;
  const key = `${own.id}/2/agreed`;
  const newOn = (id) =>
    page.locator(`#page-list [data-page="${id}"] .page-new`);
  await newOn("overview").waitFor({ ...poll, state: "attached" });
  await newOn("agreed").waitFor({ ...poll, state: "attached" });
  assert.equal((await opened()).includes(key), false);

  await page.evaluate(() => window.setVisibility("visible"));
  assert.equal(await newOn("agreed").count(), 0);
  assert.equal(
    await waitUntil(async () => (await opened()).includes(key)),
    true,
  );
  assert.equal(await newOn("overview").count(), 1);
});
