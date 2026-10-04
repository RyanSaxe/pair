import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { open } from "../support/browser.mjs";
import { fixtureHtml } from "../support/fixture.mjs";
import { waitUntil } from "../support/hub.mjs";

const quote = "Five failures open the breaker for thirty seconds";

async function select(page) {
  const paragraph = page
    .locator("#page-content p")
    .filter({ hasText: quote })
    .first();
  // The frame keeps a page hidden until its diagrams draw, and a reader
  // cannot select text on a hidden page.
  await paragraph.waitFor();
  await paragraph.evaluate((element, text) => {
    const node = [...element.childNodes].find(
      (child) =>
        child.nodeType === Node.TEXT_NODE && child.textContent.includes(text),
    );
    const start = node.textContent.indexOf(text);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + text.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, quote);
  // The frame reads the selection on selectionchange, which the browser
  // fires after this call returns. Until then, c comments on the page.
  await commentButton(page).waitFor();
}

// The button above the selection or the chosen block. Its c key hint is
// hidden from the accessible name.
const commentButton = (page, name = "Comment") =>
  page.getByRole("button", { name, exact: true });

async function openDecisions(t) {
  const page = await open(t, "http://pair.localhost/", {
    html: await fixtureHtml(),
  });
  if (!page) return null;
  await page.locator('#page-list [data-page="decisions"]').click();
  await page.getByRole("heading", { name: "Decisions" }).waitFor();
  return page;
}

async function noteDialog(page) {
  await page.locator("#note-dialog[open]").waitFor();
  return {
    anchor: await page.locator("#note-anchor").textContent(),
    quote: (await page.locator("#note-quote").isVisible())
      ? await page.locator("#note-quote").textContent()
      : null,
  };
}

const noteHighlight = () =>
  [...(CSS.highlights.get("plan-note") || [])].map((range) => range.toString());

// The frame marks a page's notes again in the animation frame after the note
// dialog closes, so each check waits for the highlight to settle.
async function highlighted(page, expected) {
  await waitUntil(async () =>
    isDeepStrictEqual(await page.evaluate(noteHighlight), expected),
  );
  assert.deepEqual(await page.evaluate(noteHighlight), expected);
}

test("a selection shows Comment just above it, which opens the note dialog with the quote", async (t) => {
  const page = await openDecisions(t);
  if (!page) return;

  await select(page);
  const button = await commentButton(page).boundingBox();
  const words = await page.evaluate(() => {
    const { x, y, width, height } = getSelection()
      .getRangeAt(0)
      .getBoundingClientRect();
    return { x, y, width, height };
  });
  assert.ok(button.y + button.height <= words.y, "above the words");
  assert.ok(words.y - (button.y + button.height) < 20, "just above them");
  assert.ok(
    button.x < words.x + words.width && button.x + button.width > words.x,
    "over the words",
  );

  await commentButton(page).click();
  assert.deepEqual(await noteDialog(page), { anchor: "Decisions", quote });
});

test("the title's Comment on this page opens a note on the page, even with words selected", async (t) => {
  const page = await openDecisions(t);
  if (!page) return;

  await select(page);
  await page.getByRole("button", { name: "Comment on this page" }).click();
  assert.deepEqual(await noteDialog(page), {
    anchor: "Decisions",
    quote: null,
  });
});

test("a chosen block's Comment button opens a note on the block", async (t) => {
  const page = await openDecisions(t);
  if (!page) return;

  const heading = "How should the payment client retry a failed charge?";
  await page.getByRole("heading", { name: heading }).click();
  await commentButton(page, "Comment on this decision").click();
  assert.deepEqual(await noteDialog(page), {
    anchor: `Decisions › ${heading}`,
    quote: null,
  });
});

test(`a note's highlight is cleared while its page or the note dialog changes, and comes back`, async (t) => {
  const page = await openDecisions(t);
  if (!page) return;

  await select(page);
  await page.keyboard.press("c");
  await page.locator("#note-quote", { hasText: quote }).waitFor();
  await page.locator("#note-text").fill("Keep the thirty second cooldown.");
  await page.getByRole("button", { name: "Add to feedback" }).click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await highlighted(page, [quote]);

  await page.keyboard.press("]");
  await page.getByRole("heading", { name: "Comparison and lists" }).waitFor();
  await highlighted(page, []);
  await page.keyboard.press("[");
  await page.getByRole("heading", { name: "Decisions" }).waitFor();
  await highlighted(page, [quote]);

  await select(page);
  await page.keyboard.press("c");
  await page.locator("#note-dialog[open]").waitFor();
  await highlighted(page, []);
  await page.keyboard.press("Escape");
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await highlighted(page, [quote]);

  // Agreed runs no note marking, so only the page change clears the
  // highlight there.
  await page.keyboard.press("[");
  await page.getByRole("heading", { name: "Agreed so far" }).waitFor();
  await highlighted(page, []);
});
