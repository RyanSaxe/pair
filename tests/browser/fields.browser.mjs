import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// iOS Safari zooms the page into a focused field whose text is under 16px.
// On a phone, and on a touch screen of any width, every field in the frame
// is at least 16px: a thread's reply box, a question's answer, and the
// fields of the note dialog and the Start popup.
test("on a phone or a touch screen every text field is at least 16px", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const plan = planData();
  plan.pages[0].html = `<p>Preserve one result per input.</p>
<section class="question" data-question="limit" data-label="Limit">
  <h3>How many failures open the breaker?</h3>
  <textarea aria-label="Your answer"></textarea>
  <div class="answer-actions"><button type="button" class="btn primary" data-answer disabled>Answer</button></div>
</section>`;
  assert.equal((await session.publish(plan)).code, 200);
  const started = await session.request(`${session.base}/api/threads`, {
    id: "why",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "Why one result per input?",
  });
  assert.equal(started.code, 201, started.body.error);
  assert.equal(
    (
      await session.action("reply", {
        note: "why",
        text: "So a retry skips it.",
      })
    ).code,
    200,
  );
  for (const device of [
    { viewport: { width: 390, height: 844 } },
    { viewport: { width: 1024, height: 768 }, hasTouch: true },
  ]) {
    const page = await open(
      t,
      `${h.server.origin}${session.base}/#overview`,
      device,
    );
    if (!page) return;
    await page.getByRole("textbox", { name: "Reply in this thread" }).waitFor();
    const fields = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")].map(
        (field) => ({
          field: field.id || field.getAttribute("aria-label") || field.type,
          size: parseFloat(getComputedStyle(field).fontSize),
        }),
      ),
    );
    assert.ok(
      fields.some((item) => item.field === "Reply in this thread"),
      JSON.stringify(fields),
    );
    assert.deepEqual(
      fields.filter((item) => item.size < 16),
      [],
      JSON.stringify(device),
    );
  }
});
