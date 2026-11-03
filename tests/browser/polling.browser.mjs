import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep, waitUntil } from "../support/hub.mjs";

test("a status poll waits for the one before it, and polling goes on after it arrives", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${a.base}/`);
  if (!page) return;
  let requests = 0;
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/api/status", async (route) => {
    requests++;
    await held;
    await route.continue();
  });
  assert.equal(await waitUntil(() => requests === 1), true);
  // The frame polls every 1.5 seconds, so this spans at least two more polls.
  await sleep(3500);
  assert.equal(requests, 1);
  release();
  assert.equal(await waitUntil(() => requests > 1), true);
});
