import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// A round whose Overview has a block a page thread can target.
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
// The tab polls the session list every 5 s.
const poll = { timeout: 8000 };
const count = (page, text) =>
  page.locator("#bell-count", { hasText: new RegExp(`^${text}$`) }).waitFor({
    ...poll,
    state: text ? "visible" : "hidden",
  });
// The bell marks every event it finds on its first load as seen, so each
// test waits for the bell to show before anything happens.
const bellReady = (page) => page.locator("#bell").waitFor();
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
  await page.locator("#bell").click();
  const line = page.locator("#center-list .session-row");
  assert.equal(
    await line.locator(".title").textContent(),
    "Round 1 is waiting for you",
  );
  assert.match(await line.locator(".words").textContent(), /^Session B · /);
  await page.keyboard.press("Escape");
  assert.equal((await b.feedback(b.event())).code, 200);
  await count(page, "");
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
  const line = page.locator("#center-list .session-row");
  assert.equal(
    await line.locator(".title").textContent(),
    "Claude Code started a session",
  );
  await line.click();
  await page.waitForURL(`${h.server.origin}${c.base}/`);
  await page.locator("#page-title", { hasText: "New session" }).waitFor();
  await page
    .locator("#activity-title", { hasText: "Preparing the first round" })
    .waitFor();
  assert.match(
    await page.locator("#home-agent").textContent(),
    /^Claude Code · started /,
  );
  // The keys that act on a page do nothing here.
  for (const key of ["]", "a", "j", "c", "r"]) await page.keyboard.press(key);
  assert.equal(new URL(page.url()).hash, "");
  assert.equal((await c.publish(round("Session C"))).code, 200);
  await page.locator("#page-title", { hasText: "Agreed so far" }).waitFor();
  assert.deepEqual(errors, []);
});
