import assert from "node:assert/strict";
import { test } from "node:test";
import {
  searchPage,
  selected,
  selectedIndex,
  type,
} from "../support/search.mjs";

test("the keys open and close search and move through it", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press("/");
  await page.locator("#search-dialog[open]").waitFor();
  await type(page, "walrus lemur");
  await page.keyboard.press("Escape");
  await page
    .locator("#search-dialog:not([open])")
    .waitFor({ state: "attached" });
  // Reopening keeps the words, selected so typing replaces them.
  await page.keyboard.press(`${modifier}+k`);
  await page.locator("#search-dialog[open]").waitFor();
  assert.equal(await page.inputValue(".search-input"), "walrus lemur");
  assert.deepEqual(
    await page.evaluate(() => {
      const { selectionStart, selectionEnd } = document.activeElement;
      return [selectionStart, selectionEnd];
    }),
    [0, "walrus lemur".length],
  );
  await type(page, "about");
  assert.equal(await selected(page).count(), 1);
  await page.keyboard.press("ArrowDown");
  assert.notEqual(await selectedIndex(page), "0");
  await page.keyboard.press("Alt+KeyS");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-menu="sessions"] .search-menu-button')
        .textContent === "All sessions",
  );
  await page.keyboard.press("Alt+KeyR");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-menu="rounds"] .search-menu-button')
        .textContent === "Latest round",
  );
});

test("inside the modal, Ctrl+J and Ctrl+K move on every system, and Ctrl+K never closes it", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.keyboard.press("/");
  await type(page, "about");
  for (const [key, index] of [
    ["Control+j", "1"],
    ["Control+k", "0"],
    ["Control+n", "1"],
    ["Control+p", "0"],
    ["ArrowDown", "1"],
    ["ArrowUp", "0"],
  ]) {
    await page.keyboard.press(key);
    assert.equal(await selectedIndex(page), index, key);
    assert.equal(await page.locator("#search-dialog[open]").count(), 1, key);
  }
  // With no element focused, as after a tap on a row, the keys still reach it.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Control+j");
  assert.equal(await selectedIndex(page), "1");
  await page.keyboard.press("Control+k");
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  if (process.platform === "darwin") {
    await page.keyboard.press("Meta+k");
    await page
      .locator("#search-dialog:not([open])")
      .waitFor({ state: "attached" });
  }
});

test("a slash in a note types a slash, and the modifier key still opens search", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press("c");
  await page.locator("#note-text").waitFor();
  await page.keyboard.press("/");
  assert.equal(await page.inputValue("#note-text"), "/");
  assert.equal(await page.locator("#search-dialog[open]").count(), 0);
  await page.keyboard.press(`${modifier}+k`);
  await page.locator("#search-dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.inputValue("#note-text"), "/");
});

test("a click outside the kinds menu only closes it, and the keys stay in the menu while it is open", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const address = page.url();
  await page.locator("#search-button").click();
  await type(page, "about");

  await page.locator('[data-menu="kinds"] .search-menu-button').click();
  const rowBox = await page.locator(".search-row").first().boundingBox();
  await page.mouse.click(
    rowBox.x + rowBox.width - 4,
    rowBox.y + rowBox.height - 4,
  );
  assert.equal(
    await page.locator('[data-menu="kinds"] .search-menu').isVisible(),
    false,
  );
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  assert.equal(page.url(), address);

  // The arrows move through the menu, and Enter toggles a kind and opens nothing.
  await page.locator('[data-menu="kinds"] .search-menu-button').click();
  await page.keyboard.press("ArrowDown");
  assert.equal(await selectedIndex(page), "0");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-menu="kinds"] .search-menu-button')
        .textContent === "Pages",
  );
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  assert.equal(page.url(), address);
});

test("typing goes to the field after the menu closes, after a click on nothing, and from a control", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const field = () => page.inputValue(".search-input");
  await page.locator("#search-button").click();
  await type(page, "ab");

  await page.locator('[data-menu="kinds"] .search-menu-button').click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("o");
  assert.equal(await field(), "abo");

  await page.locator('[data-menu="kinds"] .search-menu-button').click();
  await page.locator('[data-menu="kinds"] .search-menu-button').click();
  await page.keyboard.type("u");
  assert.equal(await field(), "abou");

  await page.locator(".search-session").click();
  await page.keyboard.type("t");
  assert.equal(await field(), "about");

  await page.locator(".search-open").focus();
  await page.keyboard.type("s");
  assert.equal(await field(), "abouts");
});

test("Tab moves through the modal's controls, and each works by key", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const focused = () =>
    page.evaluate(() => document.activeElement.textContent.trim());
  await page.locator("#search-button").click();
  await type(page, "about");
  for (const label of ["This session", "All rounds", "All kinds"]) {
    await page.keyboard.press("Tab");
    assert.equal(await focused(), label);
  }
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator('[data-menu="kinds"] .search-menu').isVisible(),
    true,
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator('[data-menu="kinds"] .search-menu').isVisible(),
    false,
  );
  assert.match(await focused(), /^Open/);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  assert.equal(await focused(), "All rounds");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-menu="rounds"] .search-menu-button')
        .textContent === "Latest round",
  );
  assert.equal(await focused(), "Latest round");
});

test("hover leaves the preview alone, a click shows a row, and a click on that row opens it", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const rowAt = async (index) => {
    const box = await page.locator(".search-row").nth(index).boundingBox();
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  await page.locator("#search-button").click();
  await type(page, "llama");

  await page.mouse.move(...(await rowAt(3)));
  await page.mouse.move(...(await rowAt(6)), { steps: 12 });
  assert.equal(await selectedIndex(page), "0");

  await page.locator(".search-row").nth(6).click();
  assert.equal(await selectedIndex(page), "6");
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);

  await page.keyboard.press("ArrowUp");
  assert.equal(await selectedIndex(page), "5");

  await page.locator(".search-row").nth(5).click();
  assert.equal(await page.locator("#search-dialog[open]").count(), 0);
});

test("a drag from the preview to the backdrop leaves the modal open", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  await page.locator("#search-button").click();
  await type(page, "walrus");
  const box = await page.locator(".search-preview-main").boundingBox();
  await page.mouse.move(box.x + 30, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, 4, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  await page.mouse.click(4, 4);
  assert.equal(await page.locator("#search-dialog[open]").count(), 0);
});
