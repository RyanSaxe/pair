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

for (const engine of ["chrome", "webkit"])
  test(`a poll that finds nothing changed transfers no body in ${engine}, and a change still arrives`, async (t) => {
    const h = await hub(t);
    const a = await h.session();
    assert.equal((await a.publish(planData())).code, 200);
    const page = await open(t, `${h.server.origin}${a.base}/#overview`, {
      engine,
    });
    if (!page) return;
    const statuses = () =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.endsWith("/api/status"))
          .map((entry) => entry.encodedBodySize),
      );
    // The page answers the first poll itself, the second fetches the body, and
    // the ones after it find nothing changed.
    assert.equal(
      await waitUntil(async () => (await statuses()).length >= 3, 10000),
      true,
    );
    const bodies = await statuses();
    assert.ok(bodies[0] > 0, String(bodies));
    assert.equal(bodies.at(-1), 0, String(bodies));
    assert.equal(await page.locator("#connection-status").textContent(), "");

    const started = await a.request(`${a.base}/api/threads`, {
      id: "kestrel",
      round: "1",
      topic: "overview",
      anchor: "Overview",
      text: "What happens to a failed item?",
    });
    assert.equal(started.code, 201, started.body.error);
    await page.locator('pair-thread[data-thread="kestrel"]').waitFor();
  });
