import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082",
  "hex",
);
const fill = async (page, title, text) => {
  await page.locator("#start-write-title").fill(title);
  await page.locator("#start-write-text").fill(text);
};

test("New work item saves a card with its image, keeps an unsent draft, and starts a card", async (t) => {
  const h = await hub(t);
  const own = await h.session();
  assert.equal((await own.publish(planData())).code, 200);
  const cards = async () => (await own.status()).body.proposals;
  const page = await open(t, `${h.server.origin}${own.base}/#work`);
  if (!page) return;
  const form = page.locator("#start-dialog");

  await page.locator("#work-new").click();
  // The form has the note dialog's field, so its text box has no drag handle.
  assert.equal(
    await page
      .locator("#start-write-text")
      .evaluate((box) => getComputedStyle(box).resize),
    "none",
  );
  await page.locator("#start-send").click();
  assert.equal(await form.isVisible(), true);
  assert.equal((await cards()).length, 0);

  await fill(page, "Dark receipts", "The logo disappears.");
  await page.locator("#start-write-images").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.locator("#start-write-strip img").waitFor();

  // Closing the dialog and reloading the page keep the text and the image.
  await page.keyboard.press("Escape");
  await form.waitFor({ state: "hidden" });
  await page.reload();
  await page.locator("#work-new").click();
  assert.equal(
    await page.locator("#start-write-title").inputValue(),
    "Dark receipts",
  );
  await page.locator("#start-write-strip img").waitFor();

  await page.locator(".actions:not([inert]) [data-start-save]").click();
  const saved = page.locator("[data-proposal-card=dark-receipts]");
  await saved.getByText("You wrote this").waitFor();
  await saved.locator("img").waitFor();
  assert.equal(await saved.locator(".page-new").count(), 0);
  assert.equal(
    await page.locator("#work-tab-proposed").getAttribute("aria-selected"),
    "true",
  );
  const [card] = await cards();
  assert.equal(card.started, null);
  assert.equal(card.attachments.length, 1);

  await page.locator("#work-new").click();
  assert.equal(await page.locator("#start-write-title").inputValue(), "");
  assert.equal(await page.locator("#start-write-strip").isVisible(), false);
  await fill(page, "Dark receipts", "A second card with the same title.");
  await page.locator("#start-send").click();
  await page
    .locator("[data-proposal-card=dark-receipts-2]")
    .getByText("Working here")
    .waitFor();
  assert.equal(
    await page.locator("#work-tab-running").getAttribute("aria-selected"),
    "true",
  );

  await page.locator("#work-new").click();
  await fill(page, "Move the logo", "Move it left.");
  await page.locator("[data-where=new-agent]").click();
  await page.locator("#start-copy").click();
  await page.locator("#start-copy:not(:has-text('Copy command'))").waitFor();
  const copied = (await cards()).find((item) => item.id === "move-the-logo");
  assert.equal(copied.started.where, "new-agent");
  assert.equal(await page.locator("#start-write-title").isDisabled(), true);
  assert.equal(
    await page.locator(".actions:not([inert]) [data-start-save]").isVisible(),
    false,
  );
});
