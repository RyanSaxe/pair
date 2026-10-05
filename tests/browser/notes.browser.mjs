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
  await commentButton(page, "Comment on selection").waitFor();
}

// The comment control in the corner, by the target it names.
const commentButton = (page, name) =>
  page.getByRole("button", { name, exact: true });

// The control's box once it names the target and has finished growing or
// shrinking.
async function settledControl(page, name) {
  await commentButton(page, name).waitFor();
  await page.waitForFunction(
    () =>
      document.getElementById("comment-here").getAnimations({ subtree: true })
        .length === 0,
  );
  return page.locator("#comment-here").boundingBox();
}

// The control's box, the right edges of the page's text and of the page,
// and the window's size, read in one frame.
const placement = (page) =>
  page.evaluate(() => {
    const box = document.getElementById("comment-here").getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      text: document.getElementById("page-content").getBoundingClientRect()
        .right,
      edge: document.getElementById("content").getBoundingClientRect().right,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
  });
// Wholly in the page's white margin, centered between the text and the
// page's right edge.
const inGutter = ({ left, right, text, edge }) =>
  left >= text && right <= edge && Math.abs(left - text - (edge - right)) <= 1;

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

test("selecting words grows the corner icon into Comment on selection, which opens the note with the quote, and clearing them shrinks it back", async (t) => {
  const page = await openDecisions(t);
  if (!page) return;

  const icon = await settledControl(page, "Comment on this page");
  assert.equal(icon.width, icon.height, "a round icon");
  await select(page);
  const grown = await settledControl(page, "Comment on selection");
  assert.match(
    await page.locator("#comment-here").innerText(),
    /^Comment on selection/,
  );
  assert.ok(grown.width > 3 * icon.width, "grown to fit its label");
  assert.equal(grown.x + grown.width, icon.x + icon.width, "grown leftward");
  assert.equal(grown.y, icon.y);

  await page.evaluate(() => getSelection().removeAllRanges());
  assert.deepEqual(await settledControl(page, "Comment on this page"), icon);

  await select(page);
  await commentButton(page, "Comment on selection").click();
  assert.deepEqual(await noteDialog(page), { anchor: "Decisions", quote });
});

test("with nothing selected, the corner icon and the c key comment on the page", async (t) => {
  const page = await openDecisions(t);
  if (!page) return;

  await commentButton(page, "Comment on this page").click();
  assert.deepEqual(await noteDialog(page), {
    anchor: "Decisions",
    quote: null,
  });
  await page.keyboard.press("Escape");
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await page.keyboard.press("c");
  assert.deepEqual(await noteDialog(page), {
    anchor: "Decisions",
    quote: null,
  });
});

test("on a wide window the corner icon is centered in the page's margin right of its text, through a resize and the sidebar closing", async (t) => {
  // Agreed draws no figure, so nothing on it changes size with the window.
  const page = await open(t, "http://pair.localhost/", {
    html: await fixtureHtml(),
  });
  if (!page) return;
  await page.getByRole("heading", { name: "Agreed so far" }).waitFor();

  await settledControl(page, "Comment on this page");
  const centered = async () => {
    await waitUntil(async () => inGutter(await placement(page)));
    const place = await placement(page);
    assert.ok(inGutter(place), JSON.stringify(place));
    assert.ok(place.height - place.bottom < 40, "near the bottom");
  };
  await centered();
  // Past the frame's widest, the gutter widens and the page keeps its size.
  await page.setViewportSize({ width: 1600, height: 720 });
  await centered();
  await page.locator("#sidebar-toggle").click();
  await centered();
});

test("on a phone the corner icon sits at the bottom right over the page, and the page's last line scrolls clear of it", async (t) => {
  const page = await open(t, "http://pair.localhost/#decisions", {
    html: await fixtureHtml(),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  if (!page) return;
  await page.getByRole("heading", { name: "Decisions" }).waitFor();

  await settledControl(page, "Comment on this page");
  const place = await placement(page);
  assert.ok(place.left < place.text, "over the page's text column");
  assert.ok(place.width - place.right <= 24, "at the right");
  assert.ok(place.height - place.bottom <= 24, "at the bottom");

  await page.evaluate(() => {
    const column = document.querySelector(".app-body");
    column.scrollTop = column.scrollHeight;
  });
  const footer = await page
    .getByRole("navigation", { name: "Previous and next" })
    .boundingBox();
  assert.ok(footer.y + footer.height <= place.top, "the last line clears it");
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

// Text shows only inside the note's text area, so a button outside it
// never covers the line being typed, even once the text scrolls.
test("the note's image button stays outside its text area on a wide window and on a phone", async (t) => {
  const page = await openDecisions(t);
  if (!page) return;

  await page.keyboard.press("c");
  await page.locator("#note-dialog[open]").waitFor();
  await page
    .locator("#note-text")
    .fill("A note long enough to scroll its field. ".repeat(20));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const [text, button] = await Promise.all(
      ["#note-text", "#note-image-pick"].map((selector) =>
        page.locator(selector).boundingBox(),
      ),
    );
    const overlap =
      button.x < text.x + text.width &&
      text.x < button.x + button.width &&
      button.y < text.y + text.height &&
      text.y < button.y + button.height;
    assert.equal(
      overlap,
      false,
      `${width}px: ${JSON.stringify({ text, button })}`,
    );
  }
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
