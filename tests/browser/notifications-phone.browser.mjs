import assert from "node:assert/strict";
import { test } from "node:test";
import { hub } from "../support/hub.mjs";
import {
  agree,
  badge,
  openOn,
  replied,
  reply,
  row,
  sessions,
  shownFrame,
  thread,
} from "../support/notifications.mjs";

/* The window on a phone's screen, in Chrome and in WebKit. */

for (const engine of ["chrome", "webkit"])
  for (const [width, height, bars] of [
    [375, 667, 114],
    [390, 844, 180],
    [320, 568, 114],
  ])
    test(`in ${engine} at ${width} by ${height}, the window fits the visible screen with and without browser bars, the list fills it, a tap splits it, and the keyboard stays down`, async (t) => {
      const h = await hub(t);
      const { here, other } = await sessions(t, h);
      for (let index = 1; index <= 13; index++)
        await replied(
          other,
          `An answer from elsewhere, number ${index}, long enough to clip`,
        );
      await thread(here, "A question no one answered");
      const options = {
        engine,
        viewport: { width, height },
        hasTouch: true,
        ...(engine === "chrome" ? { isMobile: true } : {}),
      };
      const page = await openOn(t, h, here, options);
      if (!page) return;
      // Playwright shows no browser bars, so a test gives the visual viewport the
      // height they leave, and fires its resize event.
      await page.evaluate(() => {
        window.setBars = (shown) => {
          Object.defineProperty(visualViewport, "height", {
            value: shown,
            configurable: true,
          });
          visualViewport.dispatchEvent(new Event("resize"));
        };
      });
      const fits = async (visible) => {
        const place = await page.evaluate(() => {
          const dialog = document.getElementById("search-dialog");
          const box = dialog.getBoundingClientRect();
          const inside = [".search-left", ".search-list", ".search-preview"]
            .map((selector) => dialog.querySelector(selector))
            .filter((node) => node.checkVisibility())
            .map((node) => node.getBoundingClientRect().bottom);
          return {
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            lowest: Math.max(...inside),
            over: dialog.scrollHeight - dialog.clientHeight,
            sideways: document.documentElement.scrollWidth - innerWidth,
            page: document.documentElement.scrollHeight - innerHeight,
          };
        });
        const said = JSON.stringify(place);
        assert.equal(place.top, 0, said);
        assert.equal(place.bottom, visible, said);
        assert.equal(place.left, 0, said);
        assert.equal(place.right, width, said);
        assert.ok(place.lowest <= visible + 0.5, said);
        assert.ok(place.over <= 0, said);
        assert.ok(place.sideways <= 0, said);
        assert.ok(place.page <= 0, said);
      };
      await badge(page, 14);
      await page.locator("#bell").tap();
      await page.locator("#center-all").tap();
      await page.locator(".nt-row").first().waitFor();
      await row(page, "A question no one answered").waitFor();
      await agree(page, 14);

      // The list fills the screen, with no preview and no keyboard.
      assert.notEqual(
        await page.evaluate(() => document.activeElement?.className),
        "search-input",
      );
      assert.equal(await page.locator(".search-preview").isVisible(), false);
      await fits(height);
      await page.evaluate((shown) => window.setBars(shown), height - bars);
      await fits(height - bars);
      assert.ok(
        await page
          .locator(".search-list")
          .evaluate((list) => list.scrollHeight > list.clientHeight),
      );

      // A phone shows no ✕, where a touch has no hover to show it.
      const first = page.locator(".nt-row.is-unread").first();
      if (await page.evaluate(() => matchMedia("(hover: none)").matches))
        assert.equal(await first.locator(".nt-act").isVisible(), false);

      // A tap splits the window, with the list above and the page below.
      await first.tap();
      await page.locator(".search-preview-head").waitFor();
      await shownFrame(page)
        .locator(".thread-reply textarea:visible")
        .first()
        .waitFor();
      const split = await page.evaluate(() => {
        const list = document
          .querySelector(".search-left")
          .getBoundingClientRect();
        const pane = document
          .querySelector(".search-preview")
          .getBoundingClientRect();
        return {
          listBottom: list.bottom,
          paneTop: pane.top,
          paneBottom: pane.bottom,
        };
      });
      assert.equal(split.listBottom, split.paneTop);
      assert.equal(split.paneBottom, height - bars);
      await fits(height - bars);
      await agree(page, 13);
      const open = page.locator(".search-open");
      const head = await open.evaluate((button) => {
        const box = button.getBoundingClientRect();
        return { right: box.right, inner: innerWidth };
      });
      assert.ok(head.right <= head.inner, JSON.stringify(head));

      // The bars hide, and the window takes the height.
      await page.evaluate((shown) => window.setBars(shown), height);
      await fits(height);
    });

// The page's comment button floats at the bottom of the pane, where a thread's
// reply row can be, so it hides while the reader writes a reply there.
const buttonWhileReplying = (frame) =>
  frame
    .locator(".thread-reply textarea:visible")
    .first()
    .evaluate(async (field) => {
      const button = document.getElementById("comment-here");
      const shown = () => button.checkVisibility();
      const before = shown();
      field.focus();
      const writing = shown();
      field.blur();
      return { before, writing, after: shown() };
    });
for (const engine of ["chrome", "webkit"])
  test(`in ${engine} at 375, the page's comment button hides while a reply box in the pane of Notifications or of Search has focus`, async (t) => {
    const h = await hub(t);
    const { here } = await sessions(t, h);
    await replied(here, "An answer about the walrus");
    const page = await openOn(t, h, here, {
      engine,
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      ...(engine === "chrome" ? { isMobile: true } : {}),
    });
    if (!page) return;
    await badge(page, 2);
    await page.locator("#bell").tap();
    await page.locator("#center-all").tap();
    await row(page, "walrus").tap();
    await shownFrame(page).locator(".thread-reply textarea:visible").waitFor();
    const expected = { before: true, writing: false, after: true };
    assert.deepEqual(await buttonWhileReplying(shownFrame(page)), expected);

    await page.locator(".search-close").tap();
    await page.locator("#search-dialog").waitFor({ state: "hidden" });
    await page.locator("#search-button").tap();
    await page.locator(".search-input").fill("walrus");
    // A phone shows the best result under the list with no tap.
    await page
      .locator('.search-row[aria-selected="true"]', { hasText: "walrus" })
      .waitFor();
    await page.evaluate(() => document.activeElement.blur());
    await shownFrame(page).locator(".thread-reply textarea:visible").waitFor();
    assert.deepEqual(await buttonWhileReplying(shownFrame(page)), expected);
  });
