import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep, waitUntil } from "../support/hub.mjs";

const controls = {
  id: "controls",
  title: "Page with controls",
  html: `<p>Selected words give the note a passage to quote.</p>
<section class="question" data-question="threshold" data-label="Failure threshold" data-state="open">
  <h3>How many failures open the breaker?</h3>
  <textarea aria-label="Your answer"></textarea>
  <p class="answer-text" hidden></p>
  <div class="answer-actions"><button type="button" class="btn primary" data-answer disabled>Answer</button><button type="button" class="btn" data-edit hidden>Edit</button></div>
</section>
<section id="second-block"><h3>Another block</h3><p>This block follows the question.</p></section>`,
};
const quote = "Selected words give the note a passage to quote.";

async function selectQuote(page) {
  const selected = await page
    .locator("#page-content > p")
    .evaluate((element, text) => {
      const node = element.firstChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.activeElement.blur();
      return selection.toString();
    }, quote);
  assert.equal(selected, quote);
  // The frame reads the selection on selectionchange, which the browser
  // fires after this call returns, and then shows Comment above it.
  await page.getByRole("button", { name: "Comment", exact: true }).waitFor();
}

const popoverOpen = (page, id, open) =>
  page.waitForFunction(
    ([id, open]) =>
      document.getElementById(id).matches(":popover-open") === open,
    [id, open],
  );

test(`the frame's keys open sessions, pages and dialogs, and send answers, notes and threads`, async (t) => {
  const h = await hub(t);
  const session = await h.session();
  // The frame numbers the sessions in the order they started.
  await sleep(20);
  const other = await h.session();
  assert.equal(
    (await other.publish(planData("1", undefined, "other"))).code,
    200,
  );
  assert.equal(
    (
      await session.publish({
        ...planData("1", undefined, "keys"),
        pages: [
          controls,
          {
            id: "plain",
            title: "Plain page",
            html: "<p>Nothing to edit.</p>",
          },
        ],
      })
    ).code,
    200,
  );
  const ownUrl = `${h.server.origin}${session.base}/`;
  const otherUrl = `${h.server.origin}${other.base}/`;
  const page = await open(t, ownUrl);
  if (!page) return;
  const reopen = async () => {
    await page.goto(ownUrl);
    await page.getByRole("heading", { name: "Agreed so far" }).waitFor();
    // The badge counts the other session, whose round waits for you, once
    // the session list has loaded.
    await page.waitForFunction(
      () => document.querySelector("#sessions-count")?.textContent === "1",
    );
  };
  await reopen();

  await page.keyboard.press("?");
  await page.locator("#keys-dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("#keys-dialog").waitFor({ state: "hidden" });

  await page.keyboard.press("n");
  await popoverOpen(page, "center-pop", true);
  await page.keyboard.press("Escape");
  await popoverOpen(page, "center-pop", false);

  await page.keyboard.press("g");
  await popoverOpen(page, "sessions-pop", true);
  await page.waitForFunction(
    (id) => document.activeElement?.dataset.key === `open:${id}`,
    session.id,
  );
  await page.keyboard.press("Escape");
  await popoverOpen(page, "sessions-pop", false);

  // A reload to this session's own URL would clear the marker.
  await page.evaluate(() => (window.keysMarker = true));
  await page.keyboard.press("1");
  await sleep(300);
  assert.equal(await page.evaluate(() => window.keysMarker), true);
  await page.keyboard.press("2");
  await page.waitForURL(otherUrl);
  await reopen();
  await page.keyboard.press("w");
  await page.waitForURL(otherUrl);
  await reopen();

  await page.keyboard.press("]");
  await page.getByRole("heading", { name: "Page with controls" }).waitFor();
  await page.keyboard.press("[");
  await page.getByRole("heading", { name: "Agreed so far" }).waitFor();
  await page.locator('#page-list [data-page="controls"]').click();

  const question = page.locator('[data-question="threshold"]');
  await question.waitFor({ state: "visible" });
  await page.keyboard.press("j");
  await page.waitForFunction(() =>
    document.activeElement?.matches('[data-question="threshold"]'),
  );
  await page.keyboard.press("j");
  await page.waitForFunction(
    () => document.activeElement?.id === "second-block",
  );
  await page.keyboard.press("k");
  await page.waitForFunction(() =>
    document.activeElement?.matches('[data-question="threshold"]'),
  );

  const answer = question.getByRole("textbox", { name: "Your answer" });
  await answer.focus();
  const pageUrl = await page.evaluate(() => location.href);
  await page.keyboard.press("]");
  assert.equal(await page.evaluate(() => location.href), pageUrl);
  assert.equal(await answer.inputValue(), "]");
  await answer.fill("Five failures");
  await page.keyboard.press("Shift+Enter");
  await question.locator(".answer-text").waitFor({ state: "visible" });
  assert.equal(
    await question.locator(".answer-text").textContent(),
    "Five failures",
  );

  await selectQuote(page);
  await page.keyboard.press("c");
  await page.locator("#note-quote", { hasText: quote }).waitFor();
  await page.locator("#note-text").fill("Keep this text in the page.");
  await page.keyboard.press("Shift+Enter");
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await page
    .locator("#note-count", { hasText: "1 note on this page" })
    .waitFor();

  await page.keyboard.press("s");
  await page.locator("#submit:focus").waitFor();
  await page.keyboard.press("r");
  await page.locator("#feedback-title").waitFor({ state: "visible" });
  await page.keyboard.press("a");
  await page.getByRole("heading", { name: "Agreed so far" }).waitFor();

  await page.locator('#page-list [data-page="controls"]').click();
  await selectQuote(page);
  await page.keyboard.press("c");
  await page.locator("#note-text").fill("Can we discuss this passage?");
  await page.keyboard.press("ControlOrMeta+Enter");
  assert.equal(await waitUntil(() => session.inbox.wakes.length === 1), true);
  assert.equal(
    await waitUntil(async () => {
      const status = await session.status();
      return Boolean(status.body.threads?.[0]);
    }),
    true,
  );
  const thread = (await session.status()).body.threads[0];
  assert.equal(
    (await session.action("reply", { note: thread.id, text: "Keep it." })).code,
    200,
  );
  const reply = page.getByRole("textbox", { name: "Reply in this thread" });
  await reply.waitFor({ state: "visible", timeout: 5000 });
  await reply.fill("Thanks, I will keep it.");
  await page.keyboard.press("ControlOrMeta+Enter");
  assert.equal(await waitUntil(() => session.inbox.wakes.length === 2), true);
  await page.getByText("Thanks, I will keep it.").waitFor();
  assert.equal(session.inbox.wakes.length, 2);
});
