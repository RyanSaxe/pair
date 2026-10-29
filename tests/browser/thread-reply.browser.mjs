import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

test("a reply to a waiting thread keeps its draft through a reload and posts its image", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const started = await session.request(`${session.base}/api/threads`, {
    id: "retry",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "What happens to a failed item?",
  });
  assert.equal(started.code, 201, started.body.error);
  const thread = async () => (await session.status()).body.threads[0];
  assert.equal(
    await waitUntil(async () => (await thread()).state === "sent"),
    true,
  );

  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const card = page.locator('pair-thread[data-thread="retry"]');
  const field = card.getByRole("textbox", { name: "Reply in this thread" });
  await field.fill("And the retry?");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    card.getByRole("button", { name: "Add an image" }).click(),
  ]);
  await chooser.setFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: png,
  });
  await card.locator(".thread-reply figure").waitFor();

  await page.reload();
  await field.waitFor();
  assert.equal(await field.inputValue(), "And the retry?");
  assert.equal(await card.locator(".thread-reply figure").count(), 1);
  await card.locator(".thread-reply button[type=submit]").click();
  assert.equal(
    await waitUntil(async () => (await thread()).messages.length === 2),
    true,
  );
  const message = (await thread()).messages[1];
  assert.equal(message.text, "And the retry?");
  assert.equal(message.attachments.length, 1);
  await card.locator(".thread-images img").waitFor();
  await page.reload();
  await field.waitFor();
  assert.equal(await field.inputValue(), "");
  assert.equal(await card.locator(".thread-reply figure").count(), 0);
});
