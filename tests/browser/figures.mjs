import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { fixtureHtml } from "../support/fixture.mjs";

// Each figure's source element and what the frame draws into it. A diff
// draws into the .change-view beside its input, in the same .change-review.
const figures = {
  "[data-language]": { kind: "code", drawn: ".shiki" },
  "[data-diagram]": { kind: "diagram", drawn: "svg" },
  "[data-math]": { kind: "formula", drawn: ".katex" },
  "[data-chart]": { kind: "chart", drawn: "svg" },
  "[data-prototype]": { kind: "prototype", drawn: "iframe.approved-prototype" },
  "[data-diff-input]": { kind: "diff", drawn: ".change-view > *" },
};
const pageIds = ["decisions", "comparison", "figures", "slots"];

// A figure on a visual decision's hidden tab is shown by clicking that tab.
async function reveal(page, source) {
  const tab = await source.evaluate((element) => {
    const option = element.closest(".visual-option[hidden]");
    return (
      option && {
        choice: option.closest(".visual-decision").dataset.choice,
        value: option.dataset.option,
      }
    );
  });
  if (tab)
    await page
      .locator(
        `#page-content .visual-decision[data-choice="${tab.choice}"] [data-vd-tab="${tab.value}"]`,
      )
      .click();
  const box = (await source.getAttribute("data-diff-input")) !== null;
  await (box ? source.locator("xpath=..") : source).scrollIntoViewIfNeeded();
}

for (const colorScheme of ["light", "dark"]) {
  test(`every fixture figure renders in the ${colorScheme} theme`, async (t) => {
    const html = await fixtureHtml();
    const page = await open(t, "http://pair.localhost/", {
      colorScheme,
      html,
    });
    if (!page) return;

    for (const pageId of pageIds) {
      await page.locator(`#page-list [data-page="${pageId}"]`).click();
      await page.waitForFunction(
        (id) => document.querySelector("#page-content").dataset.pageId === id,
        pageId,
      );
      const sources = page.locator(
        `#page-content :is(${Object.keys(figures).join(", ")})`,
      );
      const count = await sources.count();
      assert.ok(count > 0, `${pageId} has no figures`);
      for (let index = 0; index < count; index++) {
        const source = sources.nth(index);
        const { selector, label } = await source.evaluate(
          (element, [selectors, fallback]) => ({
            selector: selectors.find((item) => element.matches(item)),
            label:
              element.dataset.file ||
              element.dataset.title ||
              element.dataset.prototype ||
              element.dataset.caption ||
              fallback,
          }),
          [Object.keys(figures), `figure ${index + 1}`],
        );
        const { kind, drawn } = figures[selector];
        await reveal(page, source);
        // "rendered", or the text of the figure's visible .renderer-error.
        const result = await page
          .waitForFunction(
            ([source, drawn]) => {
              const box = source.closest(".change-review") || source;
              const error = source.matches("[data-diff-input]")
                ? box.querySelector("[data-diff-error]")
                : source.nextElementSibling?.matches(".renderer-error") &&
                  source.nextElementSibling;
              if (error && !error.hidden) return `error: ${error.textContent}`;
              return Boolean(box.querySelector(drawn)) && "rendered";
            },
            [await source.elementHandle(), drawn],
            { timeout: 30_000 },
          )
          .then((handle) => handle.jsonValue())
          .catch(() => "no rendered output after 30 seconds");
        assert.equal(
          result,
          "rendered",
          `${pageId}, ${colorScheme}, ${kind} ${label}: ${result}`,
        );
      }
      // The before-after and drawing components keep a hidden
      // .renderer-error in their markup.
      const errors = await page
        .locator("#page-content .renderer-error:visible")
        .allTextContents();
      assert.deepEqual(
        errors,
        [],
        `${pageId}, ${colorScheme}: ${errors.join("; ")}`,
      );
    }
  });
}
