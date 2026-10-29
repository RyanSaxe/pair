import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

test("the frame reuses a thread reply ID after its response is lost", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);

  const id = crypto.randomUUID();
  const started = await session.request(`${session.base}/api/threads`, {
    id,
    round: "1",
    topic: "overview",
    anchor: "Result line",
    target: "result",
    text: "Where does this land?",
  });
  assert.equal(started.code, 201, started.body.error);
  assert.equal(
    await waitUntil(async () =>
      (await session.status()).body.threads.some(
        (thread) => thread.id === id && thread.state === "sent",
      ),
    ),
    true,
  );
  const answered = await session.action("reply", { note: id, text: "Here." });
  assert.equal(answered.code, 200, answered.body.error);

  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const card = page.locator(`pair-thread[data-thread="${id}"]`);
  await card.waitFor();
  if ((await card.getAttribute("collapsed")) !== null)
    await card.locator(".thread-fold").click();

  const requests = [];
  await page.route(
    `${h.server.origin}${session.base}/api/threads/${id}/messages`,
    async (route) => {
      requests.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (requests.length === 1) await route.abort();
      else await route.fulfill({ response });
    },
  );
  await card.locator(".thread-reply textarea").fill("Thanks.");
  await card.locator(".thread-reply button[type=submit]").click();
  const retry = card.locator(".thread-bad button", { hasText: "Try again" });
  await retry.waitFor();
  assert.equal(requests.length, 1);
  assert.match(
    requests[0].replyId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(
    await waitUntil(
      async () =>
        (await session.status()).body.threads.find((thread) => thread.id === id)
          ?.messages.length === 3,
    ),
    true,
  );

  await retry.click();
  await card.locator(".thread-status .thread-sent").waitFor();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].replyId, requests[0].replyId);
  assert.equal(requests[1].text, "Thanks.");
});
