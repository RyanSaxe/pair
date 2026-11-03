import assert from "node:assert/strict";
import { test } from "node:test";
import { searchPage, type } from "../support/search.mjs";

// The page draws the card too, and that copy stays in the page while Work shows.
const pages = [
  {
    id: "overview",
    title: "Overview",
    html: `<p>A page with a card on it.</p>
<div class="proposal" data-proposal="tapir-work" data-kind="proposal">
  <p><b>Teach the tapir</b></p>
  <p>A tapir that can swim.</p>
</div>`,
  },
];

// Whether the word is marked, on screen, in the quote on Work's copy of the card.
const quoteMarks = (word) => {
  const marks = CSS.highlights?.get("plan-search") ?? [];
  return [...marks].some((range) => {
    const parent = range.startContainer.parentElement;
    return (
      range.toString().toLowerCase() === word &&
      range.getBoundingClientRect().width > 0 &&
      parent.closest("#work-cards [data-proposal-card=tapir-work]") &&
      parent.closest(".proposal-message")
    );
  });
};

test("a word in a card's quote marks the row, and shows the card on Work with the word marked", async (t) => {
  const { a, page } = await searchPage(t, { pages });
  if (!page) return;
  for (const fields of [
    {
      title: "Teach the tapir",
      delivers: "A tapir that can swim.",
      recommend: "here",
    },
    { start: "here", quote: "Can the tapir ford the marmot creek?" },
  ]) {
    const { code, body } = await a.action("propose", {
      id: "tapir-work",
      agent: a.agent,
      ...fields,
    });
    assert.equal(code, 200, body.error);
  }
  await page.locator("#search-button").click();
  await type(page, "marmot");
  assert.equal(
    await page.locator(".search-snippet mark").textContent(),
    "marmot",
  );
  const preview = await (
    await page.locator(".search-frame").elementHandle()
  ).contentFrame();
  await preview.waitForFunction(quoteMarks, "marmot", { timeout: 5000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.hash === "#work");
  await page.waitForFunction(quoteMarks, "marmot", { timeout: 5000 });
});
