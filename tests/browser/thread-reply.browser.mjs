import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

test("a reply to a waiting thread keeps its draft through a reload and posts its image", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const started = await session.request(`${session.base}/api/threads`, {
    id: "retry",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "What happens to a failed item?",
  });
  assert.equal(started.code, 201, started.body.error);
  const thread = async () => (await session.status()).body.threads[0];
  assert.equal(
    await waitUntil(async () => (await thread()).state === "sent"),
    true,
  );

  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const card = page.locator('pair-thread[data-thread="retry"]');
  const field = card.getByRole("textbox", { name: "Reply in this thread" });
  await field.fill("And the retry?");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    card.getByRole("button", { name: "Add an image" }).click(),
  ]);
  await chooser.setFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: png,
  });
  await card.locator(".thread-reply figure").waitFor();

  await page.reload();
  await field.waitFor();
  assert.equal(await field.inputValue(), "And the retry?");
  assert.equal(await card.locator(".thread-reply figure").count(), 1);
  await card.locator(".thread-reply button[type=submit]").click();
  assert.equal(
    await waitUntil(async () => (await thread()).messages.length === 2),
    true,
  );
  const message = (await thread()).messages[1];
  assert.equal(message.text, "And the retry?");
  assert.equal(message.attachments.length, 1);
  await card.locator(".thread-images img").waitFor();
  await page.reload();
  await field.waitFor();
  assert.equal(await field.inputValue(), "");
  assert.equal(await card.locator(".thread-reply figure").count(), 0);
});

async function replyBox(t) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const started = await session.request(`${session.base}/api/threads`, {
    id: "retry",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "What happens to a failed item?",
  });
  assert.equal(started.code, 201, started.body.error);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return {};
  const field = page
    .locator('pair-thread[data-thread="retry"]')
    .getByRole("textbox", { name: "Reply in this thread" });
  await field.waitFor();
  return { page, field };
}

test("letters typed right after a reply box loses focus are not shortcuts", async (t) => {
  const { page, field } = await replyBox(t);
  if (!page) return;
  await field.pressSequentially("and the");
  await field.evaluate((box) => box.blur());
  const hash = () => new URL(page.url()).hash;

  for (const key of ["a", "r", "]"]) await page.keyboard.press(key);
  assert.equal(hash(), "#overview");

  await page.waitForTimeout(1600);
  await page.keyboard.press("a");
  assert.equal(hash(), "#agreed");
});

test("a reply box keeps focus when a page's script adds an element after its card", async (t) => {
  const { page, field } = await replyBox(t);
  if (!page) return;
  await field.focus();
  await page.evaluate(() =>
    document
      .getElementById("page-content")
      .append(document.createElement("dialog")),
  );
  for (let polls = 0; polls < 2; polls++)
    await page.waitForResponse((response) =>
      response.url().endsWith("/api/status"),
    );
  assert.equal(
    await field.evaluate((box) => box === document.activeElement),
    true,
  );
});

test("a video in an agent's reply stays inside the thread card, with the reply's text, on a wide window and a phone", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const started = await session.request(`${session.base}/api/threads`, {
    id: "video",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "Can you show me?",
  });
  assert.equal(started.code, 201, started.body.error);
  const replied = await session.action("reply", {
    note: "video",
    html: '<p>The order page appears after the second retry succeeds.</p><video controls width="1280" height="720"></video>',
  });
  assert.equal(replied.code, 200, replied.body.error);

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 740 },
  ]) {
    const page = await open(t, `${h.server.origin}${session.base}/#overview`, {
      viewport,
    });
    if (!page) return;
    const card = page.locator('pair-thread[data-thread="video"]');
    await card.locator("video").waitFor({ state: "attached" });
    const fold = card.locator(".thread-more");
    if (await fold.isVisible()) await fold.click();
    const box = await card.evaluate((node) => {
      const right = (selector) =>
        node.querySelector(selector).getBoundingClientRect().right;
      return {
        card: node.getBoundingClientRect().right,
        video: right("video"),
        text: right(".thread-content p"),
        thumb: right(".thread-ack"),
        ratio:
          node.querySelector("video").getBoundingClientRect().width /
          node.querySelector("video").getBoundingClientRect().height,
      };
    });
    assert.ok(box.video <= box.card, JSON.stringify(box));
    assert.ok(box.text <= box.card, JSON.stringify(box));
    assert.ok(box.thumb <= box.card, JSON.stringify(box));
    assert.ok(Math.abs(box.ratio - 16 / 9) < 0.02, JSON.stringify(box));
  }
});

test("a code block or a wide table inside a wrapper scrolls within the thread card, on a wide window and a phone", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const line = `pair start --session-dir ${"/a-long-directory-name".repeat(12)}`;
  const code = `<pre data-language="shell">${line}</pre>`;
  const columns = Array.from(
    { length: 12 },
    (_, index) => `<td>Column${index}value</td>`,
  ).join("");
  const shapes = {
    list: `<ul><li>${code}</li></ul>`,
    numbered: `<ol><li>${code}</li></ol>`,
    quote: `<blockquote>${code}</blockquote>`,
    div: `<div>${code}</div>`,
    fold: `<details open><summary>More</summary>${code}</details>`,
    figure: `<figure>${code}<figcaption>A command.</figcaption></figure>`,
    table: `<div><table><tbody><tr>${columns}</tr></tbody></table></div>`,
  };
  for (const [id, html] of Object.entries(shapes)) {
    const started = await session.request(`${session.base}/api/threads`, {
      id,
      round: "1",
      topic: "overview",
      anchor: "Overview",
      text: "How do I run it?",
    });
    assert.equal(started.code, 201, started.body.error);
    const replied = await session.action("reply", { note: id, html });
    assert.equal(replied.code, 200, replied.body.error);
  }

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 740 },
  ]) {
    const page = await open(t, `${h.server.origin}${session.base}/#overview`, {
      viewport,
    });
    if (!page) return;
    for (const id of Object.keys(shapes)) {
      const card = page.locator(`pair-thread[data-thread="${id}"]`);
      await card.locator(".thread-content").waitFor({ state: "attached" });
      const expand = card.getByRole("button", { name: "Expand" });
      if (await expand.count()) await expand.click();
      const fold = card.locator(".thread-more");
      if (await fold.isVisible()) await fold.click();
      const box = await card.evaluate((node) => ({
        card: node.getBoundingClientRect().right,
        content: node.querySelector(".thread-content").getBoundingClientRect()
          .right,
        // A rule that only hid the overflow would pass the check on the
        // edges, so the wide content must still scroll into view.
        scrolls: [...node.querySelectorAll(".thread-content *")].some(
          (element) =>
            ["auto", "scroll"].includes(getComputedStyle(element).overflowX) &&
            element.scrollWidth > element.clientWidth,
        ),
      }));
      assert.ok(box.content <= box.card, `${id}: ${JSON.stringify(box)}`);
      assert.ok(box.scrolls, `${id}: ${JSON.stringify(box)}`);
    }
  }
});

// Component CSS is scoped, and a thread on a Work card sits outside
// #page-content, so the scope must also cover a thread's own content.
test("a code block in a thread on a Work card draws one box", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const proposed = await session.action("propose", {
    id: "tidy",
    title: "Tidy the list",
    delivers: "The list, tidied.",
    recommend: "here",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const started = await session.request(`${session.base}/api/threads`, {
    id: "on-card",
    round: "1",
    topic: "work",
    anchor: "Tidy the list",
    proposal: "tidy",
    text: "Which list?",
  });
  assert.equal(started.code, 201, started.body.error);
  const replied = await session.action("reply", {
    note: "on-card",
    html: '<p>This one.</p><pre data-language="text" data-file="list.txt">one\ntwo</pre>',
  });
  assert.equal(replied.code, 200, replied.body.error);

  const page = await open(t, `${h.server.origin}${session.base}/#work`);
  if (!page) return;
  const block = page.locator('#work-view pre[data-language="text"]');
  await block.waitFor();
  // The frame's generic pre rule draws this border, and the code component's
  // rule removes it.
  assert.equal(
    await block.evaluate((node) => getComputedStyle(node).borderTopWidth),
    "0px",
  );
});

// The frame can draw a thread before Shiki replaces a code block's text, and
// Shiki can fail to load at all, so the heading cannot depend on Shiki's lines.
test("a thread on words in a code block names its line before Shiki has drawn it", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const data = planData();
  data.pages[0].html +=
    '<pre id="sample" data-language="js">const one = 1;\nconst two = 2;\nconst three = 3;</pre>';
  assert.equal((await session.publish(data)).code, 200);
  const started = await session.request(`${session.base}/api/threads`, {
    id: "on-code",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    target: "sample",
    quote: "const two = 2;",
    text: "Why two?",
  });
  assert.equal(started.code, 201, started.body.error);

  const page = await open(t, "about:blank");
  if (!page) return;
  await page.route(/^https:\/\/esm\.sh\//, (route) => route.abort());
  await page.goto(`${h.server.origin}${session.base}/#overview`);
  await page
    .locator('pair-thread[data-thread="on-code"]')
    .getByText("On line 2")
    .waitFor({ timeout: 10000 });
  assert.equal(await page.locator("#sample .shiki").count(), 0);
});
