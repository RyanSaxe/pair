import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// On a phone, an alignment agreed from a note keeps its label and source
// on one line under its title, and the source's links in one row. A tap on
// the alignment chooses it, and the comment control's note on it carries
// its ID, so the card counts the note.
test("an alignment keeps its meta line and its buttons to one row each on a phone, and counts a note from the comment control", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const feedback = session.event("feedback-only", "1", {
    groups: {
      notes: [
        {
          id: "note-1",
          topic: "overview",
          anchor: "Result line",
          text: "Keep one result per input.",
        },
      ],
    },
  });
  assert.equal((await session.feedback(feedback)).code, 200);
  assert.equal((await session.action("read")).code, 200);
  const alignment = {
    id: "results",
    title: "Every input keeps exactly one result, in the order it arrived",
    html: "<p>A failed input keeps its error as its result.</p>",
    change: "new",
    sourceRefs: [{ kind: "note", submissionId: feedback.id, noteId: "note-1" }],
  };
  const published = await session.publish({
    ...planData("2"),
    agreements: [alignment],
  });
  assert.equal(published.code, 200, published.body.error);
  const page = await open(t, `${h.server.origin}${session.base}/#agreed`);
  if (!page) return;
  await page.setViewportSize({ width: 390, height: 844 });
  const card = page.locator("#agreement-results");
  await card.locator(".agreement-source button").first().waitFor();
  const rows = await card.evaluate((root) => {
    const box = (node) => node.getBoundingClientRect();
    const line = (selector) =>
      [...root.querySelectorAll(selector)].map((node) => [
        node.textContent,
        box(node).top + box(node).height / 2,
      ]);
    return {
      foot: line(".agreement-source :not(:has(*))"),
      title: box(root.querySelector("h2")).bottom,
      metaTop: root.querySelector(".card-meta")?.getBoundingClientRect().top,
      meta: line(".card-meta > :not(.state-dot)"),
    };
  });
  // Each line's text sits on one row when their middles agree.
  for (const [name, line] of Object.entries(rows).filter(([, value]) =>
    Array.isArray(value),
  )) {
    const middles = line.map(([, middle]) => middle);
    assert.ok(
      line.length && Math.max(...middles) - Math.min(...middles) <= 2,
      `${name} is one row: ${JSON.stringify(line)}`,
    );
  }
  assert.ok(rows.metaTop >= rows.title, "the meta line is under the title");
  assert.deepEqual(
    rows.meta.map(([text]) => text),
    ["New", "·", "Round 1, your note on Overview"],
  );
  assert.deepEqual(
    rows.foot.map(([text]) => text),
    ["Preview", "·", "Open"],
  );
  await card.locator(".agreement-body p").click();
  const control = page.locator(
    '#comment-here[aria-label="Comment on this alignment"]',
  );
  await control.click();
  await page.locator("#note-text").fill("Keep the order too.");
  await page.getByRole("button", { name: "Add to feedback" }).click();
  await card.locator(".card-meta", { hasText: "1 note" }).waitFor();
});

// Agreed keeps the reader's place relative to its content, which starts
// below the finished line. A reader who opens Agreed and leaves it without
// scrolling comes back to its top.
test("on a phone, Agreed opens at its top again when the reader comes back to it with the finished line showing", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const sent = await session.feedback(session.event("feedback-only", "1"));
  assert.equal(sent.code, 200, JSON.stringify(sent.body));
  assert.equal((await session.action("read")).code, 200);
  // Enough alignments that Agreed scrolls.
  const agreements = Array.from({ length: 8 }, (_, n) => ({
    id: `rule-${n}`,
    title: `Rule ${n} keeps every input's result in the order it arrived`,
    html: "<p>A failed input keeps its error as its result.</p>".repeat(3),
    change: "new",
    source: "Round 1",
  }));
  const published = await session.publish({ ...planData("2"), agreements });
  assert.equal(published.code, 200, published.body.error);
  const page = await open(t, `${h.server.origin}${session.base}/#agreed`, {
    viewport: { width: 390, height: 844 },
  });
  if (!page) return;
  await page.locator("#finished-line").waitFor();
  for (const [id, title] of [
    ["overview", "Overview"],
    ["agreed", "Agreed so far"],
  ]) {
    await page.locator("#sidebar-toggle").click();
    await page.locator(`#page-list [data-page="${id}"]`).click();
    await page.locator("#page-title", { hasText: title }).waitFor();
  }
  await page.locator("#finished-line").waitFor();
  // The return restores the place once the page's renderers settle, by a
  // task and two frames after it shows.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  );
  const tops = await page.evaluate(() =>
    [
      document.scrollingElement,
      document.querySelector("main"),
      document.querySelector(".app-body"),
    ].map((box) => box.scrollTop),
  );
  assert.deepEqual(tops, [0, 0, 0]);
});
