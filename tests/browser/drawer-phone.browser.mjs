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
