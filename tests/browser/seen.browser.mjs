import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// Each tab polls the session list every 5 s.
const poll = { timeout: 8000 };

// A computer and a phone, as two browsers with storage of their own, on one
// hub: what the reviewer clears, opens and sees on one shows on the other.
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
  // The hub has an empty record, so neither browser takes what is listed
  // as already seen.
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

  // Clear all on the computer empties the phone's bell, and the other
  // session's waiting round stops turning the sessions badge orange.
  await computer.locator("#bell").click();
  await computer.locator("#center-clear-all").click();
  await phone.locator("#bell-count").waitFor({ ...poll, state: "hidden" });
  await phone.locator("#menu-button:not(.need)").waitFor(poll);

  // Overview opened on the computer is not New on the phone.
  await computer.keyboard.press("Escape");
  await computer.locator('#page-list [data-page="overview"]').click();
  await pageNew(phone).waitFor({ ...poll, state: "detached" });

  // The card reads New on the phone's Overview until Work shows it on the
  // computer.
  await phone.goto(`${url}#overview`);
  const label = phone.locator(
    "#page-content [data-proposal-card=tidy] .page-new",
  );
  await label.waitFor(poll);
  await computer.locator("#work-row").click();
  await computer.locator("#work-cards [data-proposal-card=tidy]").waitFor();
  await label.waitFor({ ...poll, state: "detached" });
});
