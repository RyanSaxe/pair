import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pageDocs } from "../../src/hub/search/extract.mjs";
import { open } from "../support/browser.mjs";
import { fixtureHtml } from "../support/fixture.mjs";

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixture",
);

async function fixturePages() {
  const source = JSON.parse(
    await fs.readFile(path.join(fixture, "fixture.json"), "utf8"),
  );
  const prototypes = await Promise.all(
    source.prototypes.map(async ({ file, ...prototype }) => ({
      ...prototype,
      html: await fs.readFile(path.join(fixture, file), "utf8"),
    })),
  );
  return Promise.all(
    source.pages.map(async ({ file, ...page }) => ({
      ...page,
      prototypes,
      html: await fs.readFile(path.join(fixture, file), "utf8"),
    })),
  );
}

const WORD = /[\p{L}][\p{L}'-]{2,}/gu;
const words = (text) =>
  new Set((text.toLowerCase().match(WORD) ?? []).map((word) => word));

/* onScreen() reads the words a reader can see on a drawn page, through shadow
   roots. It leaves out what the plan keeps out of the index: the controls a
   component draws around its content, the diff's line numbers, and the text of
   a fold that holds a whole file. */
const CHROME =
  "button:not(.vd-pick):not([data-vd-tab]), .figure-head, .figure-caption > .figure-actions, .change-source, .renderer-error, .prototype-source, .vd-layout, script, style, textarea";
const onScreen = (chrome) => {
  const root = document.getElementById("page-content");
  let text = "";
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += ` ${node.data}`;
      return;
    }
    if (
      node.nodeType !== Node.ELEMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    )
      return;
    if (node.nodeType === Node.ELEMENT_NODE && node.matches(chrome)) return;
    if (node.shadowRoot) walk(node.shadowRoot);
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return text;
};

test("the index holds the words on every fixture page, at the frame's block numbers", async (t) => {
  const pages = await fixturePages();
  const page = await open(t, "http://pair.localhost/", {
    html: await fixtureHtml(),
  });
  if (!page) return;
  for (const source of pages) {
    const docs = pageDocs(source, "1", 0);
    const indexed = new Set();
    for (const doc of docs)
      for (const word of words(`${doc.heading} ${doc.text}`)) indexed.add(word);
    await page.evaluate((id) => {
      document.querySelector(`#page-list [data-page="${id}"]`).click();
    }, source.id);
    await page.waitForFunction(
      (id) => {
        const content = document.getElementById("page-content");
        return content.dataset.pageId === id && !content.dataset.drawing;
      },
      source.id,
      { timeout: 30000 },
    );
    const drawn = await page.evaluate(onScreen, CHROME);
    const missing = [...words(drawn)].filter((word) => !indexed.has(word));
    assert.deepEqual(missing, [], `words missing from ${source.id}`);

    const blocks = await page.evaluate(() =>
      [...document.getElementById("page-content").children].map((block) =>
        block.outerHTML.toLowerCase(),
      ),
    );
    for (const doc of docs) {
      if (!Number.isInteger(doc.block)) continue;
      const [word] = words(doc.text);
      if (word)
        assert.ok(
          blocks[doc.block]?.includes(word),
          `block ${doc.block} of ${source.id} should hold "${word}"`,
        );
    }
  }
});
