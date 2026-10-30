import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { open } from "../support/browser.mjs";
import { hub, planData, task } from "../support/hub.mjs";

// reads waits until the bold line at the top of an unpublished page reads label
// and the grey line under it reads age. An empty age means the grey line is
// hidden.
const reads = (page, label, age) =>
  page.waitForFunction(
    ([label, age]) => {
      const text = (name) => {
        const line = document.querySelector(`#page-content .${name}`);
        return line?.checkVisibility() ? line.textContent : "";
      };
      return text("pending-label") === label && text("pending-age") === age;
    },
    [label, age],
    { timeout: 5000 },
  );

test("a page the agent has not published shows its latest note and its age, which each poll updates over the same grey bars", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  // Agreed lists three pages, and the test publishes none of them.
  const agreed = await buildPage(path.join(session.directory, "source.json"), {
    name: "example",
    round: "1",
    title: "Example work",
    page: { id: "agreed", title: "Agreed so far", task, agreements: [] },
  });
  const pages = [
    { id: "timeout", title: "Timeout budget" },
    { id: "rollout", title: "Rollout plan" },
    { id: "alerts", title: "Alerts" },
  ];
  const act = async (action, data) =>
    assert.equal((await session.action(action, data)).code, 200);
  await act("publish", { html: agreed, pages });
  await act("ack", { page: "timeout", note: "Measuring p99 latency" });
  await act("progress", { start: ["rollout"] });
  const page = await open(t, `${h.server.origin}${session.base}/#timeout`);
  if (!page) return;
  const go = (id) => page.locator(`#page-list [data-page="${id}"]`).click();
  await reads(page, "Measuring p99 latency", "Noted just now");
  // A newer note must not redraw the page's .pending-skeleton, so the test
  // checks that the same element is still connected afterward.
  await page
    .locator(".pending-skeleton")
    .evaluate((bars) => (window.bars = bars));
  await act("ack", { page: "timeout", note: "Writing the budget table" });
  await reads(page, "Writing the budget table", "Noted just now");
  assert.ok(await page.evaluate(() => window.bars.isConnected));
  await go("rollout");
  await reads(page, "Preparing this page", "Started just now");
  await go("alerts");
  await reads(page, "Waiting to start", "");
  await go("timeout");
  await reads(page, "Writing the budget table", "Noted just now");
  await act("pause", { reason: "Waiting for the logs" });
  await reads(page, "Agent paused", "");
});

test("the Pages heading has one height in a session with a round in progress and a session whose round is finished", async (t) => {
  const h = await hub(t);
  const working = await h.session();
  const agreed = await buildPage(path.join(working.directory, "source.json"), {
    name: "example",
    round: "1",
    title: "Example work",
    page: { id: "agreed", title: "Agreed so far", task, agreements: [] },
  });
  const listed = await working.action("publish", {
    html: agreed,
    pages: [{ id: "timeout", title: "Timeout budget" }],
  });
  assert.equal(listed.code, 200);
  const finished = await h.session();
  assert.equal((await finished.publish(planData())).code, 200);

  const heading = async (session, status) => {
    const page = await open(t, `${h.server.origin}${session.base}/#agreed`);
    if (!page) return null;
    await page.locator(status).waitFor({ state: "attached" });
    return page.evaluate(() => {
      const label = document.querySelector("#sidebar .side-label");
      const box = label.getBoundingClientRect();
      return {
        height: box.height,
        label: label.firstElementChild.getBoundingClientRect().top - box.top,
      };
    });
  };
  const inProgress = await heading(
    working,
    "[data-round-status]:not(.idle) span:not(:empty)",
  );
  if (!inProgress) return;
  const done = await heading(finished, "[data-round-status].idle");
  assert.deepEqual(done, inProgress);
});
