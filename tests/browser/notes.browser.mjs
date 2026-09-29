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
  await page.waitForFunction(
    () =>
      document.querySelector("#quote")?.textContent === "Comment on selection",
  );
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

test(`a note's highlight is cleared while its page or the note dialog changes, and comes back`, async (t) => {
  const html = await fixtureHtml();
  const page = await open(t, "http://pair.localhost/", { html });
  if (!page) return;

  await page.locator('#page-list [data-page="decisions"]').click();
  await page.getByRole("heading", { name: "Decisions" }).waitFor();
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
