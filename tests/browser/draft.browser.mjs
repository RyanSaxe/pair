import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// The frame polls the hub's status every 1.5 s and sends a change 400 ms
// after the last edit, so each wait allows several polls.
const poll = { timeout: 8000 };

const html = `<p>Preserve one result per input.</p>
<button type="button" data-comment="Result">Comment on the result</button>
<div data-choice="approach" data-label="Approach"><button type="button" data-value="queue">Queue</button><button type="button" data-value="batch">Batch</button></div>
<section class="question" data-question="limit" data-label="Retry limit" data-state="open">
  <h3>How many retries?</h3>
  <textarea rows="2" aria-label="Your answer"></textarea>
  <p class="answer-text" hidden></p>
  <div class="answer-actions"><button type="button" class="btn primary" data-answer>Answer</button><button type="button" class="btn" data-edit hidden>Edit</button></div>
</section>`;
const round = (number) => {
  const data = planData(number);
  data.pages[0].html = html;
  return data;
};

// Two browsers have separate storage, so the only way the computer can show
// what the phone drafted is the hub's copy of the draft.
test("a note, a choice and a typed answer made on a phone appear on a computer, and a send clears both", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(round("1"))).code, 200);
  const url = `${h.server.origin}${session.base}/#overview`;
  const computer = await open(t, url);
  if (!computer) return;
  const phone = await open(t, url, { viewport: { width: 375, height: 812 } });

  await phone.getByRole("button", { name: "Queue" }).click();
  const answer = phone.locator('[data-question="limit"]');
  await answer.getByRole("textbox").fill("Three");
  await answer.getByRole("button", { name: "Answer" }).click();
  await phone.getByRole("button", { name: "Comment on the result" }).click();
  await phone.locator("#note-text").fill("Keep one result per input.");
  await phone.getByRole("button", { name: "Add to feedback" }).click();
  await phone.locator("#note-dialog").waitFor({ state: "hidden" });

  const count = "2 comments and 1 choice to send";
  await computer
    .locator("#draft-count", { hasText: count })
    .waitFor({ ...poll, state: "attached" });
  await computer
    .locator(
      '[data-choice="approach"] [data-value="queue"][aria-pressed="true"]',
    )
    .waitFor(poll);
  assert.equal(
    await computer
      .locator('[data-question="limit"]')
      .getByRole("textbox")
      .inputValue(),
    "Three",
  );
  await computer.locator("#review-row").click();
  await computer
    .locator("#feedback-groups", { hasText: "Keep one result per input." })
    .waitFor(poll);

  await phone.locator("#submit").click();
  await phone.locator("#send-button").click();
  // The computer drops what the phone sent on its next poll, while its Review
  // page is open.
  await computer
    .locator("#feedback-groups", { hasText: "Keep one result per input." })
    .waitFor({ ...poll, state: "detached" });
  await computer
    .locator("#draft-head[hidden]")
    .waitFor({ ...poll, state: "attached" });
  const { payload } = (await session.action("read")).body.event;
  assert.deepEqual(
    payload.groups.notes.map((note) => note.text),
    ["Keep one result per input."],
  );
  assert.equal((await session.publish(round("2"))).code, 200);
  // Round 2 starts with nothing to send in either browser, also after the
  // computer reloads from its own storage.
  const round2 = '#round[aria-label="Rounds, on round 2"]';
  await phone.locator(round2).waitFor({ ...poll, state: "attached" });
  assert.equal(await phone.locator("#draft-head[hidden]").count(), 1);
  await computer.goto(url);
  await computer.locator(round2).waitFor({ ...poll, state: "attached" });
  assert.equal(await computer.locator("#draft-head[hidden]").count(), 1);
  assert.equal(
    await computer
      .locator('[data-choice="approach"] [aria-pressed="true"]')
      .count(),
    0,
  );
});
