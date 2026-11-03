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
const pauseAt = (page, ms) =>
  page.evaluate((ms) => {
    for (const motion of document.getAnimations())
      if (motion.transitionProperty) {
        motion.pause();
        motion.currentTime = ms;
      }
  }, ms);
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

for (const engine of ["chrome", "webkit"]) {
  test(`in ${engine}, the drawer opens at the frame's bottom left, 330px wide and 60px over the text, and nothing on the page moves`, async (t) => {
    const { url } = await session(t);
    const page = await openPage(t, url, {
      engine,
      viewport: { width: 1280, height: 800 },
    });
    if (!page) return;
    const place = () =>
      page.evaluate(() => {
        const drawer = document.getElementById("note-dialog");
        const box = drawer.getBoundingClientRect();
        const body = drawer.parentElement.getBoundingClientRect();
        const text = document.getElementById("first").getBoundingClientRect();
        return {
          parent: drawer.parentElement.className,
          width: box.width,
          over: Math.round(box.right - text.left),
          left: drawer.offsetLeft,
          bottom: Math.round(body.height - drawer.offsetTop - box.height),
        };
      });
    const sizes = [
      [760, 60],
      [1024, 60],
      [1280, 60],
      [1920, 60],
      [3440, 60],
    ];
    for (const [width, over] of sizes) {
      await page.setViewportSize({ width, height: 800 });
      await page.keyboard.press("c");
      await page.locator("#note-dialog[open]").waitFor();
      assert.deepEqual(
        await place(),
        { parent: "app-body", width: 330, over, left: 10, bottom: 10 },
        `${width}px`,
      );
      await page.keyboard.press("Escape");
      await page.locator("#note-dialog").waitFor({ state: "hidden" });
    }

    // Nothing moves before, during or after the open and the close, with the
    // sidebar open and closed. A paused frame is part way through each.
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const sidebar of ["open", "closed"]) {
      if (sidebar === "closed") {
        await page.locator("#sidebar-toggle").click();
        await page.waitForFunction(
          () =>
            !document
              .querySelector(".sidebar")
              .getAnimations()
              .some((motion) => motion.playState === "running"),
        );
      }
      await page.locator("main").evaluate((main) => (main.scrollTop = 200));
      const before = await layout(page);
      await page.keyboard.press("?");
      await pauseAt(page, 80);
      const open = await opacity(page, "keys-dialog");
      assert.ok(open > 0 && open < 1, `opening at ${open}`);
      assert.deepEqual(await layout(page), before, `opening, ${sidebar}`);
      await finish(page);
      assert.deepEqual(await layout(page), before, `open, ${sidebar}`);
      await page.keyboard.press("Escape");
      await pauseAt(page, 80);
      const closing = await opacity(page, "keys-dialog");
      assert.ok(closing > 0 && closing < 1, `closing at ${closing}`);
      await finish(page);
      assert.deepEqual(await layout(page), before, `closed, ${sidebar}`);
    }
    assert.deepEqual((await place()).over, 284);
  });
}

test("the drawer follows a dragged sidebar up to 440px and keeps 330px on a wide page, and opens at once with reduced motion", async (t) => {
  const { url } = await session(t);
  const page = await openPage(t, url, {
    viewport: { width: 1920, height: 800 },
    reducedMotion: "reduce",
  });
  if (!page) return;
  const width = () =>
    page
      .locator("#note-dialog")
      .evaluate((drawer) => drawer.getBoundingClientRect().width);
  for (const [key, value, expected] of [
    ["pair:sidebar-width", 300, 406],
    ["pair:sidebar-width", 400, 440],
    ["pair:page-width", 1600, 330],
  ]) {
    await page.evaluate(
      ([key, value]) => {
        localStorage.removeItem("pair:sidebar-width");
        localStorage.setItem(key, value);
      },
      [key, value],
    );
    await page.reload();
    await page.locator("#first").waitFor();
    await page.keyboard.press("c");
    await page.locator("#note-dialog[open]").waitFor();
    assert.equal(await opacity(page, "note-dialog"), 1);
    assert.equal(await width(), expected, `${key} ${value}`);
  }
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

  // New work item is the tallest. It stops 10px from the header's line and the
  // window's bottom, and its form scrolls.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(`${url}#work`);
  await page.locator("#work-new").click();
  await page.locator("[data-where=new-agent]").click();
  const drawer = page.locator("#start-dialog");
  await settled(page, "start-dialog");
  assert.deepEqual(
    await drawer.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const header = document.querySelector(".frame-header");
      return [
        box.top - header.getBoundingClientRect().bottom,
        innerHeight - box.bottom,
      ];
    }),
    [10, 10],
  );
  assert.equal(await inView("start-dialog", "start-copy"), true);
  // A line sits above the buttons while part of the form is below what shows.
  const scrollForm = (to) =>
    drawer
      .locator(".dialog-body")
      .evaluate((body, to) => (body.scrollTop = to * body.scrollHeight), to);
  await scrollForm(0);
  await page.locator("#start-dialog[data-more-below]").waitFor();
  await scrollForm(1);
  await page
    .locator("#start-dialog[data-more-below]")
    .waitFor({ state: "detached" });
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

  // Each card keeps its own message under Start.
  await page.goto(`${url}#work`);
  const start = (id) =>
    page.locator(`[data-proposal-card=${id}] .proposal-start`).click();
  await start("one");
  await page.locator("#start-message").fill("For card one.");
  await start("two");
  await page.locator("#start-title", { hasText: "Card two" }).waitFor();
  assert.equal(await page.locator("#start-message").inputValue(), "");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "start-title",
  );
  await start("one");
  await page.locator("#start-title", { hasText: "Card one" }).waitFor();
  assert.equal(
    await page.locator("#start-message").inputValue(),
    "For card one.",
  );
});

for (const engine of ["chrome", "webkit"]) {
  test(`in ${engine} on a phone, the note's sheet waits for the keyboard, sits on it, and moves the page only to uncover the words`, async (t) => {
    const { url } = await session(t);
    const page = await openPage(t, url, {
      engine,
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      isMobile: engine === "chrome",
    });
    if (!page) return;
    // Playwright can't raise a phone's keyboard, so the test gives the visual
    // viewport the height a keyboard leaves and fires its resize event, as
    // search-phone.browser.mjs does. A pan is how far iOS has moved the page.
    await page.evaluate(() => {
      window.setKeyboard = (height, pan = 0) => {
        Object.defineProperty(visualViewport, "height", {
          value: height ?? innerHeight,
          configurable: true,
        });
        Object.defineProperty(visualViewport, "offsetTop", {
          value: pan,
          configurable: true,
        });
        visualViewport.dispatchEvent(new Event("resize"));
      };
    });
    const sheet = () =>
      page.evaluate(() => {
        const note = document.getElementById("note-dialog");
        const box = note.getBoundingClientRect();
        const save = document.getElementById("note-save");
        return {
          opacity: Number(getComputedStyle(note).opacity),
          modal: note.matches(":modal"),
          bottom: Math.round(box.bottom),
          keyboardTop: visualViewport.offsetTop + visualViewport.height,
          saveShown: save.getBoundingClientRect().bottom <= box.bottom,
        };
      });
    const scroll = () =>
      page.evaluate(() => document.querySelector(".app-body").scrollTop);
    // A click, because Playwright's tap on Comment leaves the note closed in
    // WebKit's phone emulation.
    const comment = async () => {
      await page.locator("#comment-here").click();
      await page.locator("#note-dialog[open]").waitFor();
    };
    const close = async () => {
      await page.locator("#note-dialog [data-close]").click();
      await page.evaluate(() => window.setKeyboard(null));
      await page.locator("#note-dialog").waitFor({ state: "hidden" });
    };

    // Words near the top: the box has focus at opacity 0, the keyboard rises,
    // and the page stays where it was.
    await select(page, quote);
    await comment();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "note-text",
    );
    assert.equal((await sheet()).opacity, 0);
    const top = await scroll();
    await page.evaluate(() => window.setKeyboard(380));
    await page.locator("#note-dialog[data-settled]").waitFor();
    await settled(page, "note-dialog");
    const up = await sheet();
    assert.equal(up.opacity, 1);
    assert.equal(up.modal, false);
    assert.equal(up.bottom, 380);
    assert.equal(await scroll(), top);
    await page.locator("#note-text").fill("A long note line.\n".repeat(40));
    await page.evaluate(() => window.setKeyboard(380, 120));
    await waitUntil(async () => (await sheet()).bottom === 500);
    assert.equal((await sheet()).saveShown, true);
    await close();

    // Words the keyboard and sheet would cover: the page scrolls up until they
    // are 12px above the sheet, and back when the sheet closes.
    await page.locator("#last").scrollIntoViewIfNeeded();
    const before = await scroll();
    await select(page, "The last words", "last");
    await comment();
    await page.evaluate(() => window.setKeyboard(380));
    await waitUntil(async () => (await scroll()) > before);
    await page
      .locator(".main-column")
      .evaluate((column) =>
        Promise.all(column.getAnimations().map((motion) => motion.finished)),
      );
    const gap = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("last"));
      const words = range.getBoundingClientRect();
      const note = document.getElementById("note-dialog");
      return note.getBoundingClientRect().top - words.bottom;
    });
    assert.ok(gap >= 12 && gap < 14, `gap ${gap}`);
    await close();
    await waitUntil(async () => (await scroll()) === before);

    // With no keyboard, as with a hardware keyboard, the sheet shows after a
    // wait. Send and Start open as modals.
    await select(page, quote);
    await comment();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.getElementById("note-dialog")).opacity ===
        "1",
    );
    await close();
    await page.locator("#submit").click();
    await page.locator("#send-dialog[open]").waitFor();
    assert.deepEqual(await openDialogs(page), ["send-dialog modal"]);
    await page.keyboard.press("Escape");
    await page.goto(`${url}#work`);
    await page.locator("[data-proposal-card=one] .proposal-start").click();
    await page.locator("#start-dialog[open]").waitFor();
    assert.deepEqual(await openDialogs(page), ["start-dialog modal"]);
  });
}
