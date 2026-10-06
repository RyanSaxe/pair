import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { open } from "../support/browser.mjs";
import { hub, task } from "../support/hub.mjs";

// The bold line at the top of a page the agent has not published, and the
// grey line under it, once they read as given. An empty age is a grey line
// that does not show.
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
  // Agreed lists three pages, and the agent publishes none of them.
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
  // A newer note leaves the round's page list as it was.
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
