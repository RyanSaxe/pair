import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, waitUntil } from "../support/hub.mjs";

const pageHtml = `
<h2>Before and after</h2>
<section class="change-review" data-kind="diff" data-file="gate.mjs">
  <div class="change-controls">
    <span class="change-layout" role="group" aria-label="Layout">
      <button type="button" data-diff-style="split">Side by side</button>
      <button type="button" data-diff-style="unified">Unified</button>
    </span>
    <button class="change-wrap" type="button" data-diff-wrap>Wrap</button>
  </div>
  <textarea data-diff-input hidden>{
    "before": "export function gate() {\\n  return \\"hold\\";\\n}\\n",
    "after": "export function gate() {\\n  return \\"open\\";\\n}\\n",
    "patch": "diff --git a/gate.mjs b/gate.mjs\\nindex 1234567..7654321 100644\\n--- a/gate.mjs\\n+++ b/gate.mjs\\n@@ -1,3 +1,3 @@\\n export function gate() {\\n-  return \\"hold\\";\\n+  return \\"open\\";\\n }\\n"
  }</textarea>
  <div class="change-view" aria-label="Before and proposed changes"></div>
  <p class="renderer-error" data-diff-error hidden></p>
  <details class="change-source"><summary>Exact source and Git patch</summary>
    <h3>Before</h3><pre data-diff-source="before"></pre>
    <h3>Proposed</h3><pre data-diff-source="after"></pre>
    <h3>Git patch</h3><pre data-diff-source="patch"></pre>
  </details>
</section>`;

// selectDiffText drags the mouse across the quote instead of setting a range,
// so Chrome reports the selection as it reports a reviewer's. For a selection
// inside the diff's shadow root, Chrome anchors it at the element around the
// shadow host.
async function selectDiffText(page, quote) {
  const view = page.locator(".change-view");
  const span = await view.evaluate((element, text) => {
    const host = [...element.querySelectorAll("*")].find(
      (node) => node.shadowRoot,
    );
    const walker = document.createTreeWalker(
      host.shadowRoot,
      NodeFilter.SHOW_TEXT,
    );
    const nodes = [];
    let content = "";
    for (let node; (node = walker.nextNode());) {
      nodes.push(node);
      content += node.data;
    }
    const start = content.indexOf(text);
    if (start < 0) throw Error(`Could not find ${text} in ${content}`);
    const point = (offset) => {
      let before = 0;
      for (const node of nodes) {
        if (offset <= before + node.data.length)
          return { node, offset: offset - before };
        before += node.data.length;
      }
      throw Error(`Could not locate offset ${offset}`);
    };
    const range = document.createRange();
    const from = point(start);
    const to = point(start + text.length);
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const rects = [...range.getClientRects()].filter((rect) => rect.width);
    const first = rects[0];
    const last = rects.at(-1);
    return {
      x0: first.left + 1,
      y0: (first.top + first.bottom) / 2,
      x1: last.right - 1,
      y1: (last.top + last.bottom) / 2,
    };
  }, quote);
  await page.mouse.move(span.x0, span.y0);
  await page.mouse.down();
  await page.mouse.move(span.x1, span.y1, { steps: 8 });
  await page.mouse.up();
}

async function startThread(page, session, quote, side, lineThreadCount = 1) {
  await selectDiffText(page, quote);
  await page.getByRole("button", { name: "Comment on selection" }).waitFor();
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.waitForFunction(
    () => document.getElementById("note-dialog").open,
    null,
    { timeout: 5000 },
  );
  assert.equal(await page.locator("#note-quote").textContent(), quote);
  await page.locator("#note-text").fill("Keep this behavior.");
  await page.locator("#note-thread").click();

  assert.equal(
    await waitUntil(async () => {
      const threads = (await session.status()).body.threads;
      return threads.some((thread) => thread.quote === quote);
    }),
    true,
  );
  const thread = (await session.status()).body.threads.find(
    (entry) => entry.quote === quote,
  );
  assert.ok(thread);
  assert.equal(thread.target, "block-changes-1");
  assert.deepEqual(thread.diffLine, { side, lineNumber: 2 });
  const card = page.locator(
    `#page-content pair-thread[data-thread="${thread.id}"]`,
  );
  await card.waitFor({ state: "visible", timeout: 5000 });
  const placement = await card.evaluate((element) => {
    const annotation = element.parentElement;
    const slot = annotation.assignedSlot;
    return {
      assigned: slot?.assignedElements().includes(annotation) ?? false,
      height: element.getBoundingClientRect().height,
      annotationSlot: annotation.slot,
      lineThreadCount: annotation.querySelectorAll("pair-thread").length,
    };
  });
  assert.equal(placement.assigned, true, JSON.stringify(placement));
  assert.ok(placement.height > 0, JSON.stringify(placement));
  assert.equal(placement.annotationSlot, `annotation-${side}-2`);
  assert.equal(placement.lineThreadCount, lineThreadCount);
}

async function openDiff(t) {
  const h = await hub(t);
  const session = await h.session();
  const published = await session.publish({
    name: "diff-line-threads",
    round: "1",
    title: "Diff line threads",
    pages: [{ id: "changes", title: "Changes", html: pageHtml }],
  });
  assert.equal(published.code, 200, published.body.error);

  const page = await open(t, `${h.server.origin}${session.base}/#changes`);
  if (!page) return {};
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".change-view *")].some(
      (node) => node.shadowRoot,
    ),
  );
  return { session, page };
}

test("selecting diff text starts a thread in its line annotation", async (t) => {
  const { session, page } = await openDiff(t);
  if (!page) return;
  await startThread(page, session, 'return "open"', "additions");
  await startThread(page, session, 'return "hold"', "deletions");
  await startThread(page, session, "open", "additions", 2);
});

test("a note on diff text marks the words selected in the diff, and the mark shows the note on hover and opens it on a click", async (t) => {
  const { page } = await openDiff(t);
  if (!page) return;
  const quote = 'return "open"';
  const note = "Keep the selected change marked.";
  await selectDiffText(page, quote);
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.waitForFunction(
    () => document.getElementById("note-dialog").open,
    null,
    { timeout: 5000 },
  );
  await page.locator("#note-text").fill(note);
  await page.getByRole("button", { name: "Add to feedback" }).click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    (text) =>
      [...(CSS.highlights.get("plan-note") || [])].some(
        (range) => range.toString() === text,
      ),
    quote,
    { timeout: 5000 },
  );
  // The words marked are the ones selected in the diff, not their copy in
  // the closed "Exact source and Git patch".
  assert.deepEqual(
    await page.evaluate(() =>
      [...(CSS.highlights.get("plan-note") || [])].map((range) => ({
        text: range.toString(),
        inDiff: Boolean(
          range.startContainer.getRootNode().host?.closest(".change-view"),
        ),
      })),
    ),
    [{ text: quote, inDiff: true }],
  );

  const mark = await page.evaluate(() => {
    const [range] = CSS.highlights.get("plan-note");
    const box = range.getBoundingClientRect();
    return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  });
  await page.mouse.move(mark.x, mark.y, { steps: 3 });
  await page.locator("#note-tip", { hasText: note }).waitFor({ timeout: 5000 });
  await page.mouse.click(mark.x, mark.y);
  await page.locator("#note-dialog[open]").waitFor({ timeout: 5000 });
  assert.equal(await page.locator("#note-title").textContent(), "Edit note");
  assert.equal(await page.locator("#note-text").inputValue(), note);
});
