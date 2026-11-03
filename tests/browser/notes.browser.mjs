import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { open } from "../support/browser.mjs";
import { fixtureHtml } from "../support/fixture.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const quote = "Five failures open the breaker for thirty seconds";

async function select(page) {
  const paragraph = page
    .locator("#page-content p")
    .filter({ hasText: quote })
    .first();
  // The frame hides a page until its diagrams draw, and the browser cannot
  // select text on a hidden page.
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
  // The frame reads the selection on selectionchange, which the browser fires
  // after this call returns. Until then, the c key comments on the whole page.
  await commentButton(page, "Comment on selection").waitFor();
}

const commentButton = (page, name) =>
  page.getByRole("button", { name, exact: true });

// The control animates when its name changes, so settledControl waits until no
// animation runs before it reads the box.
async function settledControl(page, name) {
  await commentButton(page, name).waitFor();
  await page.waitForFunction(
    () =>
      document.getElementById("comment-here").getAnimations({ subtree: true })
        .length === 0,
  );
  return page.locator("#comment-here").boundingBox();
}

const placement = (page) =>
  page.evaluate(() => {
    const box = document.getElementById("comment-here").getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      // The text stops at the column's padding on a page. Work and Review stop
      // at the text's width, and the page's margin still starts there.
      text:
        document.getElementById("content").getBoundingClientRect().right -
        parseFloat(
          getComputedStyle(document.getElementById("content")).paddingRight,
        ),
      edge: document.getElementById("content").getBoundingClientRect().right,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
  });
// inGutter is true when the control is inside the page's right margin and
// centered within 1px between the text and the page's right edge.
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
// dialog closes, so highlighted() polls until the highlight matches.
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

// A page's own control calls planUI.comment with the note's label and quote to
// open a note.
test("with nothing selected, the corner icon and the c key comment on the page, and planUI.comment opens a note", async (t) => {
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
  await page.keyboard.press("Escape");
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await page.evaluate(() => window.planUI.comment("Retry", "one retry"));
  assert.deepEqual(await noteDialog(page), {
    anchor: "Decisions › Retry",
    quote: "one retry",
  });
});

test("on a wide window the corner icon is centered in the page's margin right of its text, through a resize, the sidebar closing and a drag of the page's edge, on a page and on Work", async (t) => {
  // Agreed has no figure, so no element on it changes size with the window.
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/`);
  if (!page) return;
  await page.getByRole("heading", { name: "Agreed so far" }).waitFor();

  await settledControl(page, "Comment on this page");
  const isCentered = async () => {
    const place = await placement(page);
    assert.ok(inGutter(place), JSON.stringify(place));
    assert.ok(place.height - place.bottom < 40, "near the bottom");
  };
  const centered = async () => {
    await waitUntil(async () => inGutter(await placement(page)));
    await isCentered();
  };
  // A status poll also places the icon, so this checks before the next one is
  // due.
  const centeredThroughDrag = async (to) => {
    const { x, width } = await page.locator("#app").boundingBox();
    await page.mouse.move(x + width, 400);
    await page.mouse.down();
    await page.mouse.move(to, 400, { steps: 5 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await isCentered();
    await page.mouse.up();
  };
  await centered();
  // At 1600px the window is wider than the frame, so the gutter widens and the
  // page keeps its size.
  await page.setViewportSize({ width: 1600, height: 720 });
  await centered();
  await page.locator("#sidebar-toggle").click();
  await centered();
  await page.locator("#sidebar-toggle").click();
  await centeredThroughDrag(1500);
  await page.locator("#work-row").click();
  await settledControl(page, "Comment on Work");
  await centered();
  await centeredThroughDrag(1400);
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

// The browser draws the note's text only inside its text area, so a button
// outside the text area never covers the line being typed, even after the text
// scrolls.
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

const noteBox = (page) =>
  page.evaluate(() => {
    const text = document.getElementById("note-text");
    return {
      height: Math.round(
        text.closest(".note-field").getBoundingClientRect().height,
      ),
      scrolls: text.scrollHeight > text.clientHeight,
    };
  });

// The note opens over the comment button and grows up, and the box stops
// growing when the drawer reaches 10px from the header's line.
const drawerFull = (page) =>
  page.evaluate(async () => {
    const drawer = document.getElementById("note-dialog");
    await Promise.all(drawer.getAnimations().map((motion) => motion.finished));
    const header = document.querySelector(".frame-header");
    return Math.round(
      drawer.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom,
    );
  });

test("the note's box grows with its text until the drawer is full, opens a draft at its size, and shrinks when the text is deleted", async (t) => {
  const page = await openDecisions(t);
  if (!page) return;
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.keyboard.press("c");
  await page.locator("#note-dialog[open]").waitFor();
  assert.deepEqual(await noteBox(page), { height: 120, scrolls: false });

  const text = page.locator("#note-text");
  await text.fill("A line of the note.\n".repeat(6));
  const grown = await noteBox(page);
  assert.ok(
    grown.height > 120 && grown.height < 400 && !grown.scrolls,
    JSON.stringify(grown),
  );

  await text.fill("A line of the note.\n".repeat(60));
  const full = await noteBox(page);
  assert.equal(full.scrolls, true);
  assert.equal(await drawerFull(page), 10);

  await page.reload();
  await page.locator('#page-list [data-page="decisions"]').click();
  await page.getByRole("heading", { name: "Decisions" }).waitFor();
  await page.keyboard.press("c");
  await page.locator("#note-dialog[open]").waitFor();
  assert.equal(await text.inputValue(), "A line of the note.\n".repeat(60));
  assert.deepEqual(await noteBox(page), full);

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  assert.equal(await text.inputValue(), "");
  assert.deepEqual(await noteBox(page), { height: 120, scrolls: false });
});

test(`a note's highlight is cleared while its page changes and comes back, and the open note marks its words until it closes`, async (t) => {
  const page = await openDecisions(t);
  if (!page) return;

  await select(page);
  await page.keyboard.press("c");
  await page.locator("#note-quote", { hasText: quote }).waitFor();
  await page.locator("#note-text").fill("Keep the thirty second cooldown.");
  await page.getByRole("button", { name: "Add to draft" }).click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await highlighted(page, [quote]);

  await page.keyboard.press("]");
  await page.getByRole("heading", { name: "Comparison and lists" }).waitFor();
  await highlighted(page, []);
  await page.keyboard.press("[");
  await page.getByRole("heading", { name: "Decisions" }).waitFor();
  await highlighted(page, [quote]);

  // The note being written marks the same words as the saved note.
  await select(page);
  await page.keyboard.press("c");
  await page.locator("#note-dialog[open]").waitFor();
  await highlighted(page, [quote, quote]);
  await page.keyboard.press("Escape");
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await highlighted(page, [quote]);

  // The frame marks no notes on Agreed, so only the page change clears the
  // highlight there.
  await page.keyboard.press("[");
  await page.getByRole("heading", { name: "Agreed so far" }).waitFor();
  await highlighted(page, []);
});
