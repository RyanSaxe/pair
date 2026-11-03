import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const quote = "Each folder has a wake file that finds a running session.";
const filler = Array.from(
  { length: 12 },
  (_, index) =>
    `<p>Paragraph ${index} of the page, long enough to wrap across the column on a phone.</p>`,
).join("");

async function session(t) {
  const h = await hub(t);
  const s = await h.session();
  const plan = planData();
  plan.pages[0].html = `<p id="first">${quote}</p>
${filler}
<p id="last">The last words of the page.</p>`;
  assert.equal((await s.publish(plan)).code, 200);
  const added = await s.action("propose", {
    id: "one",
    title: "Card one",
    delivers: "What card one delivers.",
    recommend: "here",
  });
  assert.equal(added.code, 200, added.body.error);
  return { s, url: `${h.server.origin}${s.base}/` };
}

async function openPage(t, url, options) {
  const page = await open(t, `${url}#overview`, options);
  if (!page) return null;
  await page.locator("#first").waitFor();
  return page;
}

async function select(page, words, id = "first") {
  await page.evaluate(
    ([words, id]) => {
      const node = document.getElementById(id).firstChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, words.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [words, id],
  );
  await page
    .getByRole("button", { name: "Comment on selection", exact: true })
    .waitFor();
}

const settled = (page, id) =>
  page
    .locator(`#${id}`)
    .evaluate((element) =>
      Promise.all(element.getAnimations().map((motion) => motion.finished)),
    );
const openDialogs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("dialog[open]")].map((dialog) =>
      dialog.matches(":modal") ? `${dialog.id} modal` : dialog.id,
    ),
  );

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
