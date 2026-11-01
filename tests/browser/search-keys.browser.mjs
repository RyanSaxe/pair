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
      document.querySelector('[data-toggle="allSessions"]').textContent ===
      "All sessions",
  );
  await page.keyboard.press("Alt+KeyR");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-toggle="allRounds"]').textContent ===
      "Latest round",
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

  await page.locator(".search-kinds-button").click();
  const rowBox = await page.locator(".search-row").first().boundingBox();
  await page.mouse.click(
    rowBox.x + rowBox.width - 4,
    rowBox.y + rowBox.height - 4,
  );
  assert.equal(await page.locator(".search-kinds").isVisible(), false);
  assert.equal(await page.locator("#search-dialog[open]").count(), 1);
  assert.equal(page.url(), address);

  // The arrows move through the menu, and Enter toggles a kind and opens nothing.
  await page.locator(".search-kinds-button").click();
  await page.keyboard.press("ArrowDown");
  assert.equal(await selectedIndex(page), "0");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector(".search-kinds-button").textContent === "Pages",
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

  await page.locator(".search-kinds-button").click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("o");
  assert.equal(await field(), "abo");

  await page.locator(".search-kinds-button").click();
  await page.locator(".search-kinds-button").click();
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
  assert.equal(await page.locator(".search-kinds").isVisible(), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".search-kinds").isVisible(), false);
  assert.match(await focused(), /^Open/);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-toggle="allRounds"]').textContent ===
      "Latest round",
  );
  assert.equal(await focused(), "Latest round");
});

test("the selection holds while the pointer heads for Open, and follows the pointer through the list", async (t) => {
  const { page } = await searchPage(t);
  if (!page) return;
  const rowAt = async (index, along = 0.5) => {
    const box = await page.locator(".search-row").nth(index).boundingBox();
    return [box.x + box.width * along, box.y + box.height / 2];
  };
  await page.locator("#search-button").click();
  await type(page, "llama");

  // Down through the list, the selection follows the pointer.
  await page.mouse.move(...(await rowAt(0)));
  await page.mouse.move(...(await rowAt(6)), { steps: 12 });
  assert.equal(await selectedIndex(page), "6");

  // On the way to Open, the path crosses the rows above the selected one.
  const open = await page.locator(".search-open:visible").boundingBox();
  await page.mouse.move(open.x + 10, open.y + 10, { steps: 24 });
  assert.equal(await selectedIndex(page), "6");

  // Up through the list, it follows again, and a pointer that heads right and
  // stops selects the row it stopped on.
  await page.mouse.move(...(await rowAt(1, 0.2)), { steps: 12 });
  assert.equal(await selectedIndex(page), "1");
  await page.mouse.move(...(await rowAt(2, 0.8)), { steps: 8 });
  await page.waitForFunction(
    () =>
      document.querySelector('.search-row[aria-selected="true"]').dataset.i ===
      "2",
  );
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
