import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const quote = "Each folder has a wake file that finds a running session.";
const filler = (count) =>
  Array.from(
    { length: count },
    (_, index) =>
      `<p>Paragraph ${index} of the page, long enough to wrap across the column so the drawer sits beside whole lines of text.</p>`,
  ).join("");
const question = (id) =>
  `<section class="question" data-question="${id}" data-label="Question ${id}" data-state="open"><h3>Question ${id}?</h3><textarea aria-label="Your answer"></textarea><p class="answer-text" hidden></p><div class="answer-actions"><button type="button" class="btn primary" data-answer disabled>Answer</button></div></section>`;
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
  plan.pages[0].html = `<p id="first">${quote} ${filler(1)}</p>
<div data-diagram>flowchart LR
  A --> B</div>
${filler(4)}
${Array.from({ length: 10 }, (_, index) => question(`q${index}`)).join("")}
${filler(4)}
<p id="last">The last words of the page.</p>`;
  assert.equal((await s.publish(plan)).code, 200);
  for (const id of ["one", "two"]) {
    const added = await s.action("propose", {
      id,
      title: `Card ${id}`,
      delivers: `What card ${id} delivers.`,
      recommend: "here",
    });
    assert.equal(added.code, 200, added.body.error);
  }
  return { s, url: `${h.server.origin}${s.base}/` };
}

async function openPage(t, url, options = {}) {
  const page = await open(t, "about:blank", options);
  if (!page) return null;
  await stubPele(page);
  await page.goto(`${url}#overview`);
  await page.locator("#first").waitFor();
  return page;
}

async function select(page, words, id = "first") {
  await page.evaluate(
    ([words, id]) => {
      const node = document.getElementById(id).firstChild;
      const at = node.data.indexOf(words);
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + words.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [words, id],
  );
  await page
    .getByRole("button", { name: "Comment on selection", exact: true })
    .waitFor();
}

// The left edge of every line of text and the page's scroll, so a line that
// moves or a scroll shows as a difference.
const layout = (page) =>
  page.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(
      document.getElementById("page-content"),
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects())
        out.push(`${Math.round(box.left)},${Math.round(box.top)}`);
    }
    return [out.join(";"), document.querySelector("main").scrollTop];
  });
// The page has endless animations of its own, so these act on transitions only.
const finish = (page) =>
  page.evaluate(() => {
    for (const motion of document.getAnimations())
      if (motion.transitionProperty) motion.finish();
  });
// The drawer and the sheet rise 12px as they open.
const settled = (page, id) =>
  page
    .locator(`#${id}`)
    .evaluate((element) =>
      Promise.all(element.getAnimations().map((motion) => motion.finished)),
    );
const opacity = (page, id) =>
  page.evaluate(
    (id) => Number(getComputedStyle(document.getElementById(id)).opacity),
    id,
  );
const openDialogs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("dialog[open]")].map((dialog) =>
      dialog.matches(":modal") ? `${dialog.id} modal` : dialog.id,
    ),
  );
const draftNotes = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) =>
      name.endsWith(":example"),
    );
    return JSON.parse(localStorage.getItem(key)).notes.map((note) => note.text);
  });

// A drawer's box, its main button's box and the header's bottom.
const boxes = (page, id, control) =>
  page.evaluate(
    ([id, control]) => {
      const box = (element) => element.getBoundingClientRect().toJSON();
      return {
        drawer: box(document.getElementById(id)),
        control: control && box(document.querySelector(control)),
        header: box(document.querySelector(".frame-header")),
      };
    },
    [id, control],
  );
const selection = (page) =>
  page.evaluate(() => {
    const range = getSelection().getRangeAt(0);
    const lines = [...range.getClientRects()].filter((box) => box.width > 1);
    return {
      ...range.getBoundingClientRect().toJSON(),
      lastLeft: lines.at(-1).left,
    };
  });

for (const engine of ["chrome", "webkit"]) {
  test(`in ${engine}, each drawer opens beside what was clicked, moves with its words, and nothing on the page moves`, async (t) => {
    const { url } = await session(t);
    const page = await openPage(t, url, {
      engine,
      viewport: { width: 1280, height: 800 },
    });
    if (!page) return;

    // Below the words, 8px under them and lined up with their last line.
    await page.locator("main").evaluate((main) => (main.scrollTop = 0));
    await select(page, quote);
    const words = await selection(page);
    const before = await layout(page);
    await page.locator("#comment-here").click();
    assert.deepEqual(await layout(page), before, "opening");
    await finish(page);
    let { drawer, header } = await boxes(page, "note-dialog");
    assert.equal(Math.round(drawer.top), Math.round(words.bottom + 8));
    assert.equal(Math.round(drawer.left), Math.round(words.lastLeft));
    assert.equal(drawer.width, 330);
    assert.deepEqual(await layout(page), before, "open");

    // It moves with its words, and stops 10px under the header's line.
    await page.locator("main").evaluate((main) => (main.scrollTop = 40));
    await page.waitForFunction(
      (top) =>
        Math.round(
          document.getElementById("note-dialog").getBoundingClientRect().top,
        ) === top,
      Math.round(words.bottom + 8 - 40),
    );
    await page.locator("main").evaluate((main) => (main.scrollTop = 2000));
    await page.waitForFunction(
      (top) =>
        Math.round(
          document.getElementById("note-dialog").getBoundingClientRect().top,
        ) === top,
      Math.round(header.bottom + 10),
    );
    await page.keyboard.press("Escape");
    await finish(page);

    // Above words with no room under them, lined up with their first line.
    await page.locator("#last").scrollIntoViewIfNeeded();
    await select(page, "The last words", "last");
    const low = await selection(page);
    await page.keyboard.press("c");
    await settled(page, "note-dialog");
    ({ drawer } = await boxes(page, "note-dialog"));
    assert.equal(Math.round(drawer.bottom), Math.round(low.top - 8));
    await page.keyboard.press("Escape");
    await page.locator("#note-dialog").waitFor({ state: "hidden" });

    // With nothing selected, Comment opens the note over its button, lined up
    // with its right edge. Send and Keys open under the header at the right.
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.getByRole("button", { name: "Comment on this page" }).click();
    await settled(page, "note-dialog");
    let control;
    ({ drawer, control } = await boxes(page, "note-dialog", "#comment-here"));
    assert.ok(drawer.bottom <= control.top, "over the comment button");
    assert.ok(Math.abs(drawer.right - control.right) <= 12, "its right edge");
    await page.keyboard.press("Escape");
    await page.locator("#note-dialog").waitFor({ state: "hidden" });
    await page.locator("#submit").click();
    await settled(page, "send-dialog");
    ({ drawer, control } = await boxes(page, "send-dialog", "#submit"));
    assert.equal(Math.round(drawer.top), Math.round(control.bottom + 6));
    assert.equal(Math.round(drawer.right), Math.round(control.right));
    await page.keyboard.press("Escape");
    await page.locator("#send-dialog").waitFor({ state: "hidden" });
    await page.locator("main").focus();
    await page.keyboard.press("?");
    await settled(page, "keys-dialog");
    ({ drawer, header } = await boxes(page, "keys-dialog"));
    assert.ok(
      drawer.top >= header.bottom - 10 && drawer.top <= header.bottom + 10,
    );
    assert.equal(Math.round(drawer.right), Math.round(header.right - 16));
    await page.keyboard.press("Escape");

    // Start opens beside the card's Start button, and New work item under its
    // button.
    await page.goto(`${url}#work`);
    const startButton = "[data-proposal-card=one] .proposal-start";
    await page.locator(startButton).click();
    await settled(page, "start-dialog");
    ({ drawer, control } = await boxes(page, "start-dialog", startButton));
    // The card drops its New mark once Work has shown it, which can move its
    // button by a few pixels after the drawer opens.
    assert.ok(Math.abs(drawer.top - control.bottom - 6) <= 3, "under Start");
    assert.ok(Math.abs(drawer.right - control.right) <= 1, "Start's right");
    await page.keyboard.press("Escape");
    await page.locator("#start-dialog").waitFor({ state: "hidden" });
    await page.locator("#work-new").click();
    await settled(page, "start-dialog");
    ({ drawer, control } = await boxes(page, "start-dialog", "#work-new"));
    assert.equal(Math.round(drawer.top), Math.round(control.bottom + 6));
    assert.equal(Math.round(drawer.right), Math.round(control.right));
  });
}

test("a drawer over a selection with no room above or below leaves its first line in view, and opens at once with reduced motion", async (t) => {
  const { url } = await session(t);
  const page = await openPage(t, url, {
    viewport: { width: 1280, height: 500 },
    reducedMotion: "reduce",
  });
  if (!page) return;
  await page.evaluate(() => {
    const range = document.createRange();
    const end = document.querySelectorAll("#page-content > p")[3].firstChild;
    range.setStart(document.getElementById("first").firstChild, 0);
    range.setEnd(end, end.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page
    .getByRole("button", { name: "Comment on selection", exact: true })
    .waitFor();
  const words = await selection(page);
  await page.keyboard.press("c");
  await page.locator("#note-dialog[open]").waitFor();
  assert.equal(await opacity(page, "note-dialog"), 1);
  const { drawer } = await boxes(page, "note-dialog");
  assert.ok(drawer.top >= words.top + 20, `first line in view: ${drawer.top}`);
  assert.equal(Math.round(drawer.bottom), 490);
});

test("a long note, a long quote, three images, a long Send list and New work item keep the buttons in view in a short window", async (t) => {
  const { url } = await session(t);
  const page = await openPage(t, url, {
    viewport: { width: 1280, height: 500 },
  });
  if (!page) return;
  const inView = (id, button) =>
    page.evaluate(
      ([id, button]) => {
        const drawer = document.getElementById(id).getBoundingClientRect();
        const box = document.getElementById(button).getBoundingClientRect();
        return box.bottom <= drawer.bottom && drawer.bottom <= innerHeight;
      },
      [id, button],
    );
  await select(page, quote);
  await page.evaluate(() => {
    const range = getSelection().getRangeAt(0);
    range.setEndAfter(document.getElementById("first"));
  });
  await page.locator("#comment-here").click();
  await page.locator("#note-text").fill("A long note line.\n".repeat(40));
  for (let count = 1; count <= 3; count++) {
    await page.locator("#note-image-input").setInputFiles(png);
    await page
      .locator("#note-images img")
      .nth(count - 1)
      .waitFor();
  }
  await settled(page, "note-dialog");
  assert.equal(await inView("note-dialog", "note-save"), true);
  await page.locator("#note-save").click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });

  for (const box of await page.locator("[data-question] textarea").all())
    await box.fill("A typed answer.");
  await page.locator("#submit").click();
  await page.locator("#send-not-added li").nth(9).waitFor();
  await settled(page, "send-dialog");
  assert.equal(await inView("send-dialog", "send-button"), true);
  await page.keyboard.press("Escape");

  // New work item is the tallest. It opens under its button, stops 10px above
  // the window's bottom, and its form scrolls.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(`${url}#work`);
  await page.locator("#work-new").click();
  await page.locator("[data-where=new-agent]").click();
  const drawer = page.locator("#start-dialog");
  await settled(page, "start-dialog");
  assert.deepEqual(
    await drawer.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const button = document
        .getElementById("work-new")
        .getBoundingClientRect();
      return [Math.round(box.top - button.bottom), innerHeight - box.bottom];
    }),
    [6, 10],
  );
  assert.equal(await inView("start-dialog", "start-copy"), true);
  // A line sits under the title while part of the form is above what shows,
  // and above the buttons while part of it is below.
  const scrollForm = (to) =>
    drawer
      .locator(".dialog-body")
      .evaluate((body, to) => (body.scrollTop = to * body.scrollHeight), to);
  await scrollForm(0);
  await page.locator("#start-dialog[data-more-below]").waitFor();
  assert.equal(await page.locator("#start-dialog[data-more-above]").count(), 0);
  await scrollForm(1);
  await page.locator("#start-dialog[data-more-above]").waitFor();
  await page
    .locator("#start-dialog[data-more-below]")
    .waitFor({ state: "detached" });

  // Keys has no buttons, so only the line under its title shows.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.keyboard.press("?");
  const keys = page.locator("#keys-dialog[open]");
  await keys.waitFor();
  await keys
    .locator(".dialog-body")
    .evaluate((body) => (body.scrollTop = body.scrollHeight));
  await page.locator("#keys-dialog[data-more-above]").waitFor();
  assert.equal(await page.locator("#keys-dialog[data-more-below]").count(), 0);
});

test("the page stays in use behind one drawer at a time, and a note with words is added before another drawer opens", async (t) => {
  const { url } = await session(t);
  const page = await openPage(t, url, {
    viewport: { width: 1280, height: 800 },
  });
  if (!page) return;
  const pause = () => page.waitForTimeout(1600);

  // Words in the box are added to the draft when Keys opens, with no motion,
  // and focus moves into Keys.
  await select(page, quote);
  await page.locator("#comment-here").click();
  await page.locator("#note-text").fill("Added when Keys opens.");
  await page.locator("#note-text").blur();
  await pause();
  await page.keyboard.press("?");
  assert.equal(await opacity(page, "keys-dialog"), 1);
  assert.deepEqual(await openDialogs(page), ["keys-dialog"]);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "keys-title",
  );
  assert.deepEqual(await draftNotes(page), ["Added when Keys opens."]);

  // A click on the page leaves the drawer open, and the page's keys still act.
  await page.locator("#page-title").click();
  await page.keyboard.press("j");
  await page.locator("#chosen-bar").waitFor();
  assert.deepEqual(await openDialogs(page), ["keys-dialog"]);

  // c replaces Keys with a note on the chosen block. Escape closes a menu
  // first, then the drawer, and an empty note adds nothing.
  await page.keyboard.press("c");
  await page.locator("#note-dialog[open]").waitFor();
  assert.deepEqual(await openDialogs(page), ["note-dialog"]);
  await page.locator("#note-text").blur();
  await page.keyboard.press("n");
  await page.locator("#center-pop:popover-open").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("#center-pop:popover-open").waitFor({ state: "detached" });
  assert.deepEqual(await openDialogs(page), ["note-dialog"]);
  await page.keyboard.press("Escape");
  await page.locator("#note-dialog").waitFor({ state: "hidden" });

  // The full-size diagram opens over a note as a modal, and Escape closes only
  // the modal.
  await select(page, "Each folder");
  await page.locator("#comment-here").click();
  await page.locator("[data-diagram] svg").click();
  await page.locator("#diagram-dialog[open]").waitFor();
  assert.deepEqual(await openDialogs(page), [
    "diagram-dialog modal",
    "note-dialog",
  ]);
  await page.keyboard.press("Escape");
  await page.locator("#diagram-dialog").waitFor({ state: "hidden" });
  assert.deepEqual(await openDialogs(page), ["note-dialog"]);

  // While an image uploads, the note stays and nothing else opens.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/api/upload", async (route) => {
    await held;
    await route.continue();
  });
  await page.locator("#note-text").fill("Waits for its image.");
  const started = page.waitForRequest("**/api/upload");
  await page.locator("#note-image-input").setInputFiles(png);
  await started;
  await page.locator("#note-text").blur();
  await pause();
  await page.keyboard.press("?");
  assert.deepEqual(await openDialogs(page), ["note-dialog"]);
  release();
  await page.locator("#note-images img").waitFor();
  // A second click on Add to draft lands while the drawer closes, and adds
  // nothing.
  await page.locator("#note-save").dblclick();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  assert.deepEqual(await draftNotes(page), [
    "Added when Keys opens.",
    "Waits for its image.",
  ]);

  // Each card keeps its own message under Start. The drawer under a card's
  // Start covers the cards below it, so this starts the lower card first and
  // closes the drawer before going back to it.
  await page.goto(`${url}#work`);
  const start = (id) =>
    page.locator(`[data-proposal-card=${id}] .proposal-start`).click();
  await start("two");
  await page.locator("#start-message").fill("For card two.");
  await start("one");
  await page.locator("#start-title", { hasText: "Card one" }).waitFor();
  assert.equal(await page.locator("#start-message").inputValue(), "");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "start-title",
  );
  await page.keyboard.press("Escape");
  await page.locator("#start-dialog").waitFor({ state: "hidden" });
  await start("two");
  await page.locator("#start-title", { hasText: "Card two" }).waitFor();
  assert.equal(
    await page.locator("#start-message").inputValue(),
    "For card two.",
  );
});
