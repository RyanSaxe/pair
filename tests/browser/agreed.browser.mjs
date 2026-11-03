import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// A tap on an alignment chooses it. The note that the comment control then
// opens contains the alignment's ID, and the frame counts the note on the
// alignment's card by that ID.
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
  // The test counts items whose vertical middles are within 2px of each other
  // as one row.
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

// cardSource publishes round 2 with an alignment that cites a thread on a
// proposal's card.
async function cardSource(t) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const proposed = await session.action("propose", {
    id: "rex",
    title: "Restart the Rex server",
    delivers: "The server answers again.",
    recommend: "here",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const id = crypto.randomUUID();
  const started = await session.request(`${session.base}/api/threads`, {
    id,
    proposal: "rex",
    text: "Can this wait until morning?",
  });
  assert.equal(started.code, 201, started.body.error);
  assert.equal(
    (await session.feedback(session.event("feedback-only", "1"))).code,
    200,
  );
  assert.equal((await session.action("read")).code, 200);
  const published = await session.publish({
    ...planData("2"),
    agreements: [
      {
        id: "wait",
        title: "Rex restarts in the morning",
        html: "<p>It can wait.</p>",
        sourceRefs: [{ kind: "thread", threadId: id }],
      },
    ],
  });
  assert.equal(published.code, 200, published.body.error);
  return { h, session, id };
}

test("an alignment from a thread on a card names the card with no round, and Open shows the thread on Work", async (t) => {
  const { h, session, id } = await cardSource(t);
  const page = await open(t, `${h.server.origin}${session.base}/#agreed`);
  if (!page) return;
  const card = page.locator("#agreement-wait");
  await card.locator(".agreement-source a").waitFor();
  assert.equal(
    await card.locator(".card-meta").innerText(),
    "Your thread on Restart the Rex server",
  );
  assert.deepEqual(
    await card.locator(".agreement-source :not(:has(*))").allInnerTexts(),
    ["Open"],
  );
  await card.locator(".agreement-source a").click();
  const thread = page.locator(`#work-view #thread-${id}`);
  await thread.waitFor();
  assert.ok(await thread.innerText().then((text) => text.includes("morning")));
  assert.equal(new URL(page.url()).hash, "#work");
  assert.equal(new URL(page.url()).searchParams.get("target"), `thread-${id}`);
});

test("a thread source that has no round and no card says your thread, with no link", async (t) => {
  const { h, session } = await cardSource(t);
  const pages = path.join(session.directory, "pages", "2");
  const file = path.join(
    pages,
    (await fs.readdir(pages)).find((name) => name.startsWith("agreed")),
  );
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  stored.page.agreements[0].sourceRecords = [
    {
      kind: "thread",
      threadId: "no-such-thread",
      text: "Can this wait until morning?",
      href: "./undefined.undefined.html#undefined",
    },
  ];
  await fs.writeFile(file, JSON.stringify(stored));
  const page = await open(t, `${h.server.origin}${session.base}/#agreed`);
  if (!page) return;
  const card = page.locator("#agreement-wait");
  await card.locator(".card-meta").waitFor();
  assert.equal(await card.locator(".card-meta").innerText(), "Your thread");
  assert.equal(await card.locator(".agreement-source a").count(), 0);
  assert.equal(await card.locator(".agreement-source").isVisible(), false);
  assert.doesNotMatch(await card.innerText(), /undefined/);
});

// The frame saves the reader's place on Agreed relative to its content, which
// starts below the finished line. A reader who leaves Agreed without scrolling
// must come back to its top.
test("on a phone, Agreed opens at its top again when the reader comes back to it with the finished line showing", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const sent = await session.feedback(session.event("feedback-only", "1"));
  assert.equal(sent.code, 200, JSON.stringify(sent.body));
  assert.equal((await session.action("read")).code, 200);
  // Eight alignments make Agreed tall enough to scroll.
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
  // The frame restores the place after the page's renderers settle, which is by
  // a task and two animation frames after the page shows.
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
