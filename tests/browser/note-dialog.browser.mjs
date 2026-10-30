import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const html = `<button type="button" data-comment="Result">Comment on the result</button>`;

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
