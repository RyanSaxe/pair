import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { open } from "../support/browser.mjs";
import { hub, task } from "../support/hub.mjs";

const quote = "The retry uses the same idempotency key as the first try.";
const text =
  "A retry costs one slow request in the rare case it is needed, and it recovers most of the orders lost today. ";
const overview = `<p id="first">${quote} ${text}</p>
<section id="example"><h3>An example block</h3><p>${text}</p><button type="button" class="btn" data-comment="Example">Comment on the example</button></section>
<p>${text.repeat(3)}</p>`;

// The agent publishes Overview and leaves Later for the end, so the round
// stays open and Agreed shows the progress card with Message the agent.
async function setup(t) {
  const h = await hub(t);
  const session = await h.session();
  const build = (page) =>
    buildPage(path.join(session.directory, "source.json"), {
      name: "example",
      round: "1",
      title: "Example work",
      page,
    });
  const publish = async (page, extra = {}) => {
    const html = await build(page);
    const result = await session.action("publish", { html, ...extra });
    assert.equal(result.code, 200, result.body.error);
  };
  await publish(
    { id: "agreed", title: "Agreed so far", task, agreements: [] },
    {
      pages: [
        { id: "overview", title: "Overview" },
        { id: "later", title: "Later" },
      ],
    },
  );
  await publish({ id: "overview", title: "Overview", html: overview });
  const added = await session.action("propose", {
    id: "one",
    title: "Card one",
    delivers: "What card one delivers.",
    recommend: "here",
  });
  assert.equal(added.code, 200, added.body.error);
  return {
    url: `${h.server.origin}${session.base}/`,
    finish: () =>
      publish({ id: "later", title: "Later", html: `<p>${text}</p>` }),
  };
}

const boxOf = (page, selector) =>
  page.locator(selector).evaluate((element) => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });
const selectionBox = (page) =>
  page.evaluate(() => {
    const { top, bottom, left, right } = getSelection()
      .getRangeAt(0)
      .getBoundingClientRect();
    return { top, bottom, left, right };
  });
async function select(page) {
  await page.locator("#first").evaluate((element, words) => {
    const range = document.createRange();
    range.setStart(element.firstChild, 0);
    range.setEnd(element.firstChild, words.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, quote);
  await page
    .getByRole("button", { name: "Comment on selection", exact: true })
    .waitFor();
}
// opened() waits for the drawer to finish its rise, and returns its box.
async function opened(page, id) {
  const drawer = page.locator(`#${id}`);
  await page.locator(`#${id}[open]`).waitFor();
  await drawer.evaluate((element) =>
    Promise.all(element.getAnimations().map((motion) => motion.finished)),
  );
  assert.equal(
    await drawer.evaluate((element) => element.matches(":modal")),
    false,
  );
  return boxOf(page, `#${id}`);
}
async function close(page, id) {
  await page.keyboard.press("Escape");
  await page.locator(`#${id}`).waitFor({ state: "hidden" });
}
// A drawer is next to what opened it when it is at most 10px above or below
// it and overlaps it across.
function assertNext(drawer, trigger, label) {
  const gap = Math.max(
    drawer.top - trigger.bottom,
    trigger.top - drawer.bottom,
  );
  const across =
    Math.min(drawer.right, trigger.right) - Math.max(drawer.left, trigger.left);
  assert.ok(gap >= -1 && gap <= 10, `${label}: ${gap}px away`);
  assert.ok(across > 0, `${label}: beside it, ${across}px across`);
}

test("every drawer on a computer opens next to the button, words, block or card it came from", async (t) => {
  const { url, finish } = await setup(t);
  const page = await open(t, `${url}#agreed`, {
    viewport: { width: 1280, height: 800 },
  });
  if (!page) return;

  // Message the agent, on the progress card while the round is open.
  const message = page.getByRole("button", { name: "Message the agent" });
  await message.waitFor();
  const button = await boxOf(page, "#activity-message");
  await message.click();
  assertNext(await opened(page, "note-dialog"), button, "Message the agent");
  await close(page, "note-dialog");

  await finish();
  await page.goto(`${url}#overview`);
  await page.locator("#first").waitFor();
  const comment = page.locator("#comment-here");
  const opens = [
    // Words, with Comment on selection and with c.
    [
      "selection's Comment",
      () => select(page),
      () => selectionBox(page),
      () => comment.click(),
    ],
    [
      "c on a selection",
      () => select(page),
      () => selectionBox(page),
      () => page.keyboard.press("c"),
    ],
    // Nothing selected: beside the comment button, also for c.
    [
      "Comment",
      () => page.evaluate(() => getSelection().removeAllRanges()),
      () => boxOf(page, "#comment-here"),
      () => comment.click(),
    ],
    [
      "c with nothing selected",
      () => page.locator("main").focus(),
      () => boxOf(page, "#comment-here"),
      () => page.keyboard.press("c"),
    ],
    // A button on the page, and a chosen block with c and with Comment.
    [
      "a comment button on the page",
      () => {},
      () => boxOf(page, "[data-comment]"),
      () => page.locator("[data-comment]").click(),
    ],
    [
      "c on a chosen block",
      () => page.keyboard.press("j"),
      () => boxOf(page, "#example"),
      () => page.keyboard.press("c"),
    ],
    [
      "Comment on a chosen block",
      () => page.keyboard.press("j"),
      () => boxOf(page, "#example"),
      () => comment.click(),
    ],
    // Send, by its button and by s then Enter.
    [
      "Send",
      () => {},
      () => boxOf(page, "#submit"),
      () => page.locator("#submit").click(),
      "send-dialog",
    ],
    [
      "s then Enter",
      () => page.keyboard.press("s"),
      () => boxOf(page, "#submit"),
      () => page.keyboard.press("Enter"),
      "send-dialog",
    ],
  ];
  for (const [label, before, trigger, act, id = "note-dialog"] of opens) {
    await before();
    const box = await trigger();
    await act();
    assertNext(await opened(page, id), box, label);
    await close(page, id);
  }

  // A note's mark, and Edit on Review.
  await select(page);
  await comment.click();
  await page.locator("#note-text").fill("A note to open again.");
  await page.locator("#note-save").click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  const mark = await boxOf(page, "#first");
  await page.mouse.click(mark.left + 20, mark.top + 8);
  assertNext(
    await opened(page, "note-dialog"),
    { ...mark, bottom: mark.top + 22 },
    "a note's mark",
  );
  await close(page, "note-dialog");
  await page.keyboard.press("r");
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await edit.waitFor();
  const editBox = await edit.evaluate((element) => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });
  await edit.click();
  assertNext(await opened(page, "note-dialog"), editBox, "Edit on Review");
  await close(page, "note-dialog");

  // Work: Start on a card, a chosen card's Comment, and New work item.
  await page.goto(`${url}#work`);
  const start = page.locator("[data-proposal-card=one] .proposal-start");
  await start.waitFor();
  const startBox = await boxOf(
    page,
    "[data-proposal-card=one] .proposal-start",
  );
  await start.click();
  assertNext(await opened(page, "start-dialog"), startBox, "Start");
  await close(page, "start-dialog");
  await page.locator("[data-proposal-card=one] .proposal-delivers").click();
  const card = await boxOf(page, "[data-proposal-card=one]");
  await comment.click();
  assertNext(await opened(page, "note-dialog"), card, "a chosen card");
  await close(page, "note-dialog");
  const newBox = await boxOf(page, "#work-new");
  await page.locator("#work-new").click();
  assertNext(await opened(page, "start-dialog"), newBox, "New work item");
  await close(page, "start-dialog");

  // Keys has no button, so it opens under the header at the right.
  await page.locator("main").focus();
  await page.keyboard.press("?");
  const header = await boxOf(page, ".frame-header");
  const keys = await opened(page, "keys-dialog");
  assert.ok(Math.abs(keys.top - header.bottom) <= 10, "Keys under the header");
  assert.ok(
    Math.abs(keys.right - (header.right - 16)) <= 1,
    "Keys at the right",
  );
});
