import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

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
${filler}`;
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

async function select(page, words) {
  await page.evaluate(
    ([words, id]) => {
      const node = document.getElementById(id).firstChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, words.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [words, "first"],
  );
  await page
    .getByRole("button", { name: "Comment on selection", exact: true })
    .waitFor();
}

const openDialogs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("dialog[open]")].map((dialog) =>
      dialog.matches(":modal") ? `${dialog.id} modal` : dialog.id,
    ),
  );

// Playwright can't raise a touch keyboard, so the test gives the visual
// viewport the height a keyboard leaves and fires its resize event, as
// search-phone.browser.mjs does.
const stubKeyboard = (page) =>
  page.evaluate(() => {
    window.setKeyboard = (height) => {
      Object.defineProperty(visualViewport, "height", {
        value: height ?? innerHeight,
        configurable: true,
      });
      visualViewport.dispatchEvent(new Event("resize"));
    };
  });
// A modal glides to its place above a keyboard once the keyboard has stopped
// changing, so a test waits until the box has stopped and is centered above it.
const rest = (page, id) =>
  page.waitForFunction((id) => {
    const dialog = document.getElementById(id);
    const box = dialog.getBoundingClientRect();
    return (
      !dialog.getAnimations().length &&
      Math.abs(box.top - (visualViewport.height - box.bottom)) <= 1
    );
  }, id);
const box = (page, selector) =>
  page
    .locator(selector)
    .evaluate((element) => element.getBoundingClientRect().toJSON());
// The modal's box, as gaps from the top of the window and from the top of the
// keyboard, and whether its main button shows.
const placed = (page, id, button) =>
  page.evaluate(
    ([id, button]) => {
      const box = document.getElementById(id).getBoundingClientRect();
      const main = document.getElementById(button).getBoundingClientRect();
      return {
        modal: document.getElementById(id).matches(":modal"),
        top: Math.round(box.top),
        bottom: Math.round(visualViewport.height - box.bottom),
        buttonShown: main.top >= box.top && main.bottom <= box.bottom,
      };
    },
    [id, button],
  );

// A tablet is wider than 720px, and its pointer is coarse, so it gets the
// modals too.
for (const engine of ["chrome", "webkit"]) {
  test(`in ${engine} on a phone and a tablet, the note, Send and Start open as modals and stay above the keyboard`, async (t) => {
    const { url } = await session(t);
    for (const [width, height] of [
      [375, 667],
      [1024, 768],
      [768, 1024],
    ]) {
      const page = await openPage(t, url, {
        engine,
        viewport: { width, height },
        hasTouch: true,
        isMobile: engine === "chrome" && width < 720,
      });
      if (!page) return;
      await stubKeyboard(page);
      const size = `${width}x${height}`;

      // A click, because Playwright's tap on Comment leaves the note closed in
      // WebKit's phone emulation.
      await select(page, quote);
      await page.locator("#comment-here").click();
      await page.locator("#note-dialog[open]").waitFor();
      await page.locator("#note-text").fill("A long note line.\n".repeat(30));
      const keyboard = Math.round(height * 0.45);
      await page.evaluate((top) => window.setKeyboard(top), height - keyboard);
      await rest(page, "note-dialog");
      const note = await placed(page, "note-dialog", "note-save");
      assert.deepEqual(
        note,
        { ...note, modal: true, buttonShown: true },
        `note, ${size}`,
      );
      assert.ok(note.top >= 10 && note.bottom >= 10, `note, ${size}`);
      assert.ok(Math.abs(note.top - note.bottom) <= 1, `centered, ${size}`);
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.setKeyboard(null));
      await page.locator("#note-dialog").waitFor({ state: "hidden" });

      await page.locator("#submit").click();
      await page.locator("#send-dialog[open]").waitFor();
      assert.deepEqual(await openDialogs(page), ["send-dialog modal"], size);
      await page.keyboard.press("Escape");
      await page.goto(`${url}#work`);
      await page.locator("[data-proposal-card=one] .proposal-start").click();
      await page.locator("#start-dialog[open]").waitFor();
      assert.deepEqual(await openDialogs(page), ["start-dialog modal"], size);
      await page.context().browser().close();
    }
  });
}

// iOS pans the whole page, dimmed page and modal together, to reach a text box
// that the rising keyboard would cover, and then the modal moves again to fit
// above the keyboard. So a modal whose text box takes focus is placed above the
// keyboard before it rises, at the height of the last keyboard in a window this
// wide. Send's message box takes focus after Send is open, and its modal goes
// above the keyboard as it does.
for (const engine of ["chrome", "webkit"]) {
  test(`in ${engine} on a phone and a tablet, a text box in a modal takes focus above the keyboard, so the keyboard moves nothing`, async (t) => {
    const { url } = await session(t);
    for (const [width, height] of [
      [375, 667],
      [1024, 768],
    ]) {
      const page = await openPage(t, url, {
        engine,
        viewport: { width, height },
        hasTouch: true,
        isMobile: engine === "chrome" && width < 720,
      });
      if (!page) return;
      await stubKeyboard(page);
      const size = `${width}x${height}`;
      const top = height - Math.round(height * 0.45);
      const raise = () => page.evaluate((top) => window.setKeyboard(top), top);
      const drop = () => page.evaluate(() => window.setKeyboard(null));
      const openNote = async () => {
        await select(page, quote);
        await page.locator("#comment-here").click();
        await page.locator("#note-dialog[open]").waitFor();
      };

      // The first note shows the frame how tall this window's keyboard is.
      await openNote();
      await raise();
      await rest(page, "note-dialog");
      await page.keyboard.press("Escape");
      await drop();
      await page.locator("#note-dialog").waitFor({ state: "hidden" });

      await openNote();
      const opened = await box(page, "#note-dialog");
      assert.ok((await box(page, "#note-text")).bottom <= top, size);
      await raise();
      await rest(page, "note-dialog");
      assert.deepEqual(await box(page, "#note-dialog"), opened, size);
      await page.keyboard.press("Escape");
      await drop();

      await page.locator("#submit").click();
      await page.locator("#send-dialog[open]").waitFor();
      await page.locator("#send-message").click();
      const message = await box(page, "#send-message");
      const dialog = await box(page, "#send-dialog");
      assert.ok(message.top >= dialog.top && message.bottom <= top, size);
      await page.context().browser().close();
    }
  });
}
