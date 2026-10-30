import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const words = "same idempotency key";
const html = `<p>Retries send the ${words} on every attempt.</p>
<p>Refunds reuse the ${words} as the charge.</p>
<button type="button" data-comment="Result">Comment on the result</button>
<button type="button" data-comment="Cost">Comment on the cost</button>`;

const png = {
  name: "shot.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
    "base64",
  ),
};

async function session(t) {
  const h = await hub(t);
  const s = await h.session();
  const plan = planData();
  plan.pages[0].html = html;
  assert.equal((await s.publish(plan)).code, 200);
  const notes = async () =>
    Object.values((await s.request(`${s.base}/api/draft`)).body.items)
      .map((item) => item.value)
      .filter((value) => value?.text);
  return {
    session: s,
    url: `${h.server.origin}${s.base}/`,
    // hubNotes waits for the frame's next push and returns the notes once the
    // hub's copy has exactly these texts.
    hubNotes: async (...texts) => {
      const held = async () => (await notes()).map((note) => note.text).sort();
      await waitUntil(
        async () => isDeepStrictEqual(await held(), texts.sort()),
        8000,
      );
      assert.deepEqual(await held(), texts.sort());
      return notes();
    },
    onHub: async (image) =>
      (await s.request(`${s.base}/api/upload/${image.id}`)).code === 200,
    uploads: () => fs.readdir(path.join(s.directory, "uploads")),
  };
}
const dialog = (page) => page.locator("#note-dialog");
const opened = (page) => page.locator("#note-dialog[open]").waitFor();
const closed = (page) => dialog(page).waitFor({ state: "hidden" });
const comment = async (page, name) => {
  await page.getByRole("button", { name }).click();
  await opened(page);
};
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function attach(page, count) {
  await page.locator("#note-image-input").setInputFiles(png);
  await page
    .locator("#note-images img")
    .nth(count - 1)
    .waitFor();
}
// pickImage returns when the browser has started the upload.
async function pickImage(page) {
  const started = page.waitForRequest("**/api/upload");
  await page.locator("#note-image-input").setInputFiles(png);
  await started;
}
// holdUploads keeps each upload from reaching the hub until release is
// called, which stands in for a large image on a slow connection.
async function holdUploads(page) {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/api/upload", async (route) => {
    await held;
    await route.continue();
  });
  return release;
}
async function send(page, s) {
  await page.locator("#submit").click();
  await page.locator("#send-button").click();
  assert.equal(
    await waitUntil(
      async () => (await s.status()).body.latestSubmissionId,
      8000,
    ),
    true,
    await page.locator("#submit-error").textContent(),
  );
  return (await s.action("read")).body.event.payload;
}

test("removing a note's image takes effect only when the edit is saved, and the round sends", async (t) => {
  const { session: s, url, hubNotes, onHub } = await session(t);
  const page = await open(t, `${url}#overview`);
  if (!page) return;
  await comment(page, "Comment on the result");
  await page.locator("#note-text").fill("Look at these.");
  await attach(page, 1);
  await attach(page, 2);
  await page.locator("#note-save").click();
  await closed(page);
  const [note] = await hubNotes("Look at these.");
  const [removed, kept] = note.attachments;

  await page.goto(`${url}#feedback`);
  const backOuts = [
    () => dialog(page).locator("[data-close]").click(),
    () => page.keyboard.press("Escape"),
    () => page.mouse.click(4, 4),
  ];
  for (const backOut of backOuts) {
    await button(page, "Edit").click();
    await opened(page);
    await page
      .getByRole("button", { name: "Remove this image" })
      .first()
      .click();
    assert.equal(await page.locator("#note-images img").count(), 1);
    await backOut();
    await closed(page);
    assert.equal(await onHub(removed), true);
  }

  await button(page, "Edit").click();
  await opened(page);
  assert.equal(await page.locator("#note-images img").count(), 2);
  await page.getByRole("button", { name: "Remove this image" }).first().click();
  await page.locator("#note-save").click();
  await closed(page);
  await waitUntil(async () => !(await onHub(removed)));
  assert.equal(await onHub(removed), false);
  assert.equal(await onHub(kept), true);

  const payload = await send(page, s);
  assert.deepEqual(
    payload.groups.notes[0].attachments.map((image) => image.id),
    [kept.id],
  );
});

test("a note waits for an image still uploading, and keeps it", async (t) => {
  const { url, hubNotes } = await session(t);
  const page = await open(t, `${url}#overview`);
  if (!page) return;
  const release = await holdUploads(page);
  await comment(page, "Comment on the result");
  await page.locator("#note-text").fill("Look at this.");
  await pickImage(page);

  await page.locator("#note-text").press("Shift+Enter");
  assert.equal(await dialog(page).isVisible(), true);
  assert.equal(await page.locator("#note-uploading").isVisible(), true);
  assert.equal(await page.locator("#note-thread").isDisabled(), true);
  assert.equal(await page.locator("#note-save").isDisabled(), true);

  release();
  await page.locator("#note-images img").waitFor();
  assert.equal(await page.locator("#note-uploading").isVisible(), false);
  await page.locator("#note-text").press("Shift+Enter");
  await closed(page);
  const [note] = await hubNotes("Look at this.");
  assert.equal(note.attachments.length, 1);
});

test("an image still uploading when the reviewer backs out stays off the next note and off the hub", async (t) => {
  const { url, hubNotes, uploads } = await session(t);
  const page = await open(t, `${url}#overview`);
  if (!page) return;
  const release = await holdUploads(page);
  await comment(page, "Comment on the result");
  await pickImage(page);
  await page.keyboard.press("Escape");
  await closed(page);

  await comment(page, "Comment on the cost");
  assert.equal(await page.locator("#note-uploading").isVisible(), false);
  await page.locator("#note-text").fill("No image here.");
  const uploaded = page.waitForResponse("**/api/upload");
  release();
  await uploaded;
  // The frame deletes the upload after it finishes, so the wait ends when
  // the hub has written the file and deleted it again.
  await waitUntil(async () => (await uploads()).length === 0);
  assert.deepEqual(await uploads(), []);
  assert.equal(await page.locator("#note-images img").count(), 0);

  await page.locator("#note-save").click();
  await closed(page);
  const [note] = await hubNotes("No image here.");
  assert.equal(note.attachments, undefined);
});

// The frame reads a selection on selectionchange, which the browser fires
// after the script returns. Clearing the selection first makes the button's
// name change, so the wait cannot pass on the previous selection.
async function commentOnWords(page, paragraph) {
  await page.evaluate(() => getSelection().removeAllRanges());
  await button(page, "Comment on this page").waitFor();
  await page
    .locator("#page-content p")
    .nth(paragraph)
    .evaluate((element, text) => {
      const node = element.firstChild;
      const start = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      getSelection().addRange(range);
    }, words);
  await button(page, "Comment on selection").click();
  await opened(page);
}

test("the same words selected in two paragraphs keep separate drafts", async (t) => {
  const { url, hubNotes } = await session(t);
  const page = await open(t, `${url}#overview`);
  if (!page) return;
  const field = page.locator("#note-text");
  await page.locator("#page-content p").first().waitFor();

  await commentOnWords(page, 0);
  await field.fill("About the retries.");
  await page.keyboard.press("Escape");
  await closed(page);

  await commentOnWords(page, 1);
  assert.equal(await field.inputValue(), "");
  await field.fill("About the refunds.");
  await page.keyboard.press("Escape");
  await closed(page);

  await commentOnWords(page, 0);
  assert.equal(await field.inputValue(), "About the retries.");
  await page.locator("#note-save").click();
  await closed(page);

  await commentOnWords(page, 1);
  assert.equal(await field.inputValue(), "About the refunds.");
  await page.locator("#note-save").click();
  await closed(page);

  const saved = await hubNotes("About the refunds.", "About the retries.");
  assert.notEqual(saved[0].target, saved[1].target);
});
