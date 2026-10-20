import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { assemble } from "../../src/build/assemble.mjs";
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

// A native parse error reaches pair through Pele's returned error handle
// and onError callback. It must stay within its own figure.
test("a malformed diagram preserves its source without hiding another diagram or the rest of the page", async (t) => {
  const source = "flowchart LR\n  A[";
  const html = await assemble({
    name: "diagram-failure",
    round: "1",
    title: "Diagram failure",
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: `<p id="readable">Read the rest of this page.</p><div id="bad" data-diagram>${source}</div><div id="good" data-diagram>flowchart LR\n  A --> B</div>`,
      },
    ],
  });
  const page = await open(t, "http://pair.localhost/#overview", { html });
  if (!page) return;
  await page.locator("#bad + .renderer-error:visible").waitFor();
  await page.locator("#good svg").waitFor();
  assert.equal(await page.locator("#bad").textContent(), source);
  assert.equal(await page.locator("#readable").isVisible(), true);
  assert.equal(await page.locator("#bad .pele-error, body > svg").count(), 0);
});

test("a complex diagram opens at readable size and scrolls within its modal on desktop and phone", async (t) => {
  const source = ["flowchart LR"];
  for (let stage = 0; stage < 8; stage++) {
    for (let lane = 0; lane < 8; lane++) {
      const node = `S${stage}L${lane}`;
      source.push(`${node}["Stage ${stage + 1}, lane ${lane + 1}"]`);
      if (!stage) continue;
      source.push(`S${stage - 1}L${lane} --> ${node}`);
      source.push(`S${stage - 1}L${(lane + 1) % 8} --> ${node}`);
    }
  }
  const html = await assemble({
    name: "complex-diagram",
    round: "1",
    title: "Complex diagram",
    pages: [
      {
        id: "overview",
        title: "Overview",
        html: `<div data-diagram>${source.join("\n")}</div>`,
      },
    ],
  });
  for (const width of [1360, 375]) {
    const page = await open(t, "http://pair.localhost/#overview", {
      html,
      viewport: { width, height: 700 },
    });
    if (!page) return;
    await page
      .locator("[data-diagram] svg")
      .click({ position: { x: 2, y: 2 } });
    const view = page.locator("#diagram-dialog[open] .lightbox-view");
    await view.waitFor();
    const size = await view.evaluate((element) => {
      const svg = element.querySelector("svg");
      const scale =
        svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      return {
        textSize:
          parseFloat(
            getComputedStyle(svg.querySelector(".pele-label")).fontSize,
          ) * scale,
        overflowX: element.scrollWidth > element.clientWidth,
        overflowY: element.scrollHeight > element.clientHeight,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(
      size.textSize >= 13,
      `labels shrank to ${size.textSize}px at ${width}px`,
    );
    assert.equal(size.pageWidth, width);
    assert.equal(size.overflowX, true);
    assert.equal(size.overflowY, true);
    await view.hover();
    await page.mouse.wheel(10000, 10000);
    await page.waitForFunction(() => {
      const element = document.querySelector("#diagram-dialog .lightbox-view");
      return element.scrollLeft > 0 && element.scrollTop > 0;
    });
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#diagram-dialog").evaluate((el) => el.open),
      false,
    );
    await page.close();
  }
});
