import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, literal, planData } from "../support/hub.mjs";

test("a card whose work runs in its own session is in Done from the start, and its status line follows that session", async (t) => {
  const h = await hub(t);
  const parent = await h.session({ start: true });
  assert.equal((await parent.publish(planData())).code, 200);
  for (const [id, title] of [
    ["deck", "Build the deck"],
    ["export", "Refresh the export"],
  ]) {
    const added = await parent.action("propose", {
      id,
      title,
      delivers: `${title}, delivered.`,
      recommend: "sub-session",
    });
    assert.equal(added.code, 200, added.body.error);
  }
  const page = await open(t, `${h.server.origin}${parent.base}/#work`);
  if (!page) return;
  const tab = (id) => page.locator(`#work-tab-${id}`);
  const deck = page.locator("#work-cards [data-proposal-card=deck]");
  const reads = (line) =>
    deck
      .locator(".card-meta", { hasText: new RegExp(`^${literal(line)}$`) })
      .waitFor({ timeout: 8000 });
  const counts = async () =>
    Object.fromEntries(
      await page
        .locator("#work-tabs [role=tab]")
        .evaluateAll((tabs) =>
          tabs.map((item) => [
            item.id.slice("work-tab-".length),
            item.querySelector(".work-count").textContent,
          ]),
        ),
    );

  await tab("proposed").locator(".work-count", { hasText: "2" }).waitFor();
  await deck.locator(".proposal-start").click();
  await page.locator("#start-send").click();
  await page.locator("#start-dialog").waitFor({ state: "hidden" });
  // The started card stays on the reviewer's tab until the reviewer changes tab.
  await reads("Opening a sub-session·Waiting for its session to start");
  await page.locator("#work-tab-proposed[aria-selected=true]").waitFor();
  assert.deepEqual(await counts(), { running: "0", proposed: "1", done: "1" });

  // The sidebar's number counts only the proposal that waits for Start.
  const number = page.locator("#work-row .count");
  await page.locator("#work-row[aria-label='Work, 1 proposed']").waitFor();
  assert.equal(await number.textContent(), "1");
  const edges = await page.locator("#work-row").evaluate((row) => ({
    rowEnd:
      row.getBoundingClientRect().right -
      parseFloat(getComputedStyle(row).paddingRight),
    number: row.querySelector(".count").getBoundingClientRect().right,
  }));
  assert.equal(Math.round(edges.number), Math.round(edges.rowEnd));
  // The number is plain muted text, like the counts on Work's tabs.
  const looks = (selector) =>
    page.locator(selector).evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.color, style.backgroundColor, style.fontWeight];
    });
  assert.deepEqual(
    await looks("#work-row .count"),
    await looks("#work-tab-proposed .work-count"),
  );

  await tab("done").click();
  await reads("Opening a sub-session·Waiting for its session to start");

  // A card that no browser has shown gets no New label in Done, as it starts.
  const added = await parent.action("propose", {
    id: "chart",
    title: "Draw the chart",
    delivers: "The chart, drawn.",
    recommend: "sub-session",
  });
  assert.equal(added.code, 200, added.body.error);
  const begun = await parent.action("propose", {
    id: "chart",
    start: "sub-session",
    quote: "Draw it in its own session.",
  });
  assert.equal(begun.code, 200, begun.body.error);
  const chart = page.locator("#work-cards [data-proposal-card=chart]");
  await chart.waitFor({ timeout: 8000 });
  assert.equal(await chart.locator(".page-new").count(), 0);

  const child = await h.session({
    start: true,
    from: parent.directory,
    proposal: "deck",
  });
  await reads("In its own session·Open");
  assert.equal(
    await deck.locator(".card-meta a").getAttribute("href"),
    `${child.base}/`,
  );

  assert.equal((await child.publish(planData())).code, 200);
  await reads("Waiting for you·In its own session · Open");

  const thread = crypto.randomUUID();
  const asked = await parent.request(`${parent.base}/api/threads`, {
    id: thread,
    proposal: "deck",
    text: "Which template?",
  });
  assert.equal(asked.code, 201, asked.body.error);
  const replied = await parent.action("reply", {
    note: thread,
    text: "Board.",
  });
  assert.equal(replied.code, 200, replied.body.error);
  await reads("Agent replied·In its own session · Open");

  await page.locator("#bell").click();
  await page.locator("#center-clear-all").click();
  await page.keyboard.press("Escape");
  await reads("Waiting for you·In its own session · Open");

  const sent = await child.feedback(child.event("feedback-only", "1"));
  assert.equal(sent.code, 200, JSON.stringify(sent.body));
  await reads("In its own session·Open");

  const closed = await parent.request(`${child.base}/api/dismiss`, {});
  assert.equal(closed.code, 200, closed.body.error);
  await reads("Done·Done in its own session");

  const box = await h.inbox();
  const reopened = await h.register(child.directory, box.target, {
    start: true,
    reopen: true,
  });
  assert.equal(reopened.code, 200, reopened.body.error);
  await reads("In its own session·Open");
  await page.locator("#work-tab-done[aria-selected=true]").waitFor();
  assert.deepEqual(await counts(), { running: "0", proposed: "1", done: "2" });
});
