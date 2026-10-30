import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep, waitUntil } from "../support/hub.mjs";

// The frame polls the hub's status every 1.5 s and sends a change 400 ms
// after the last edit, so each wait allows several polls.
const poll = { timeout: 8000 };

const html = `<p>The final launch video goes out on Friday.</p>
<button type="button" data-comment="Result">Comment on the result</button>
<div data-choice="approach" data-label="Approach"><button type="button" data-value="queue">Queue</button><button type="button" data-value="batch">Batch</button></div>
<div class="scope-list" data-multiselect="scope" data-label="Scope"><p class="scope-count"></p><label><input type="checkbox" class="scope-check" data-value="logs"> Logs</label><label><input type="checkbox" class="scope-check" data-value="alerts"> Alerts</label></div>
<section class="question" data-question="limit" data-label="Retry limit" data-state="open">
  <h3>How many retries?</h3>
  <textarea rows="2" aria-label="Retry limit"></textarea>
  <p class="answer-text" hidden></p>
  <div class="answer-actions"><button type="button" class="btn primary" data-answer>Answer</button><button type="button" class="btn" data-edit hidden>Edit</button></div>
</section>
<section class="question" data-question="owner" data-label="Owner" data-state="open">
  <h3>Who owns the cut?</h3>
  <textarea rows="2" aria-label="Owner"></textarea>
  <p class="answer-text" hidden></p>
  <div class="answer-actions"><button type="button" class="btn primary" data-answer>Answer</button><button type="button" class="btn" data-edit hidden>Edit</button></div>
</section>
<section class="drawing-question" data-drawing-question="endcard" data-label="End card">
  <h3>Where does the logo sit?</h3>
  <div class="drawing-stage"><div class="drawing-canvas"><img class="drawing-preview" alt="Saved drawing" hidden /></div><button class="btn" type="button" data-draw>Draw your answer</button></div>
  <p class="renderer-error" data-drawing-error role="status" hidden></p>
</section>`;
const round = (number) => {
  const data = planData(number);
  data.pages[0].html = html;
  return data;
};

// silence is one second of a WAV file, which a video element can load, so a
// test can move a real media element's position without a binary fixture.
function silence() {
  const rate = 8000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + rate, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(rate, 40);
  return Buffer.concat([header, Buffer.alloc(rate, 0x80)]).toString("base64");
}

// session() publishes the round and a thread whose agent reply has a video,
// so a test can tell when the frame draws the page again: the thread card
// and its video are then new elements.
async function session(t) {
  const h = await hub(t);
  const s = await h.session();
  assert.equal((await s.publish(round("1"))).code, 200);
  const started = await s.request(`${s.base}/api/threads`, {
    id: "video",
    round: "1",
    topic: "overview",
    anchor: "Overview",
    text: "Show me the launch video.",
  });
  assert.equal(started.code, 201, started.body.error);
  await waitUntil(
    async () => (await s.status()).body.threads[0].state === "sent",
  );
  const replied = await s.action("reply", {
    note: "video",
    html: `<p>Here it is.</p><video controls muted src="data:audio/wav;base64,${silence()}"></video>`,
  });
  assert.equal(replied.code, 200, replied.body.error);
  return {
    session: s,
    url: `${h.server.origin}${s.base}/#overview`,
    draft: async () => (await s.request(`${s.base}/api/draft`)).body,
  };
}
const button = (page, value) =>
  page.locator(`[data-choice="approach"] [data-value="${value}"]`);
const pressed = (page, value) =>
  button(page, value).and(page.locator('[aria-pressed="true"]')).waitFor(poll);
const box = (page, value) =>
  page.locator(`[data-multiselect="scope"] input[data-value="${value}"]`);
const reply = (page) =>
  page
    .locator('pair-thread[data-thread="video"]')
    .getByRole("textbox", { name: "Reply in this thread" });
// mark() labels the video in the thread card, so kept() can tell whether the
// page still shows the same element.
const mark = (page) =>
  page.locator("pair-thread video").evaluate((video) => {
    video.dataset.kept = "";
  });
const kept = async (page) =>
  (await page.locator("pair-thread video[data-kept]").count()) === 1;
// settled() waits until the hub's draft has not changed for three polls.
async function settled(draft) {
  let last = (await draft()).revision;
  for (let tries = 0; tries < 6; tries++) {
    await sleep(4500);
    const now = (await draft()).revision;
    if (now === last) return now;
    last = now;
  }
  assert.fail(`The hub's draft was still changing at revision ${last}.`);
}
const typedText = [
  "Not answered yet.",
  "Half a note.",
  "Half a reply.",
  "Typed in the Send popup.",
];
const holdsTyped = (draft) =>
  typedText.some((text) => JSON.stringify(draft).includes(text));

// Two browsers have separate storage, so the only way the computer can show
// what the phone did is the hub's copy of the draft.
test("what the reviewer completes on one device appears on the other, and text they only typed stays where they typed it", async (t) => {
  const { session: s, url, draft } = await session(t);
  const computer = await open(t, url);
  if (!computer) return;
  const phone = await open(t, url, { viewport: { width: 375, height: 812 } });

  await button(phone, "queue").click();
  await box(phone, "logs").check();
  const limit = phone.locator('[data-question="limit"]');
  await limit.getByRole("textbox").fill("Three");
  await limit.getByRole("button", { name: "Answer" }).click();
  await phone.getByRole("button", { name: "Comment on the result" }).click();
  await phone.locator("#note-text").fill("Keep the logo for a beat.");
  await phone.getByRole("button", { name: "Add to feedback" }).click();
  await phone.locator("#note-dialog").waitFor({ state: "hidden" });
  // None of these is complete: no Answer, no Add to feedback, no Send.
  await phone
    .locator('[data-question="owner"]')
    .getByRole("textbox")
    .fill("Not answered yet.");
  await phone.getByRole("button", { name: "Comment on the result" }).click();
  await phone.locator("#note-text").fill("Half a note.");
  await phone.keyboard.press("Escape");
  await reply(phone).fill("Half a reply.");
  await phone.locator("#submit").click();
  await phone.locator("#send-message").fill("Typed in the Send popup.");
  await phone.keyboard.press("Escape");

  await pressed(computer, "queue");
  await computer
    .locator('[data-multiselect="scope"] input[data-value="logs"]:checked')
    .waitFor(poll);
  // The phone pressed Answer, so the computer shows the answer as text with
  // Edit, as the phone does.
  const answered = computer.locator('[data-question="limit"]');
  await answered.locator(".answer-text", { hasText: "Three" }).waitFor(poll);
  assert.equal(await answered.locator("[data-edit]").isVisible(), true);
  await computer
    .locator("#draft-count", { hasText: "2 comments and 2 choices to send" })
    .waitFor({ ...poll, state: "attached" });
  // The computer makes a choice too, and the phone shows it.
  await button(computer, "batch").click();
  await pressed(phone, "batch");
  await settled(draft);
  assert.equal(holdsTyped(await draft()), false);
  assert.equal(
    await computer
      .locator('[data-question="owner"]')
      .getByRole("textbox")
      .inputValue(),
    "",
  );
  assert.equal(await reply(computer).inputValue(), "");
  await computer.getByRole("button", { name: "Comment on the result" }).click();
  assert.equal(await computer.locator("#note-text").inputValue(), "");
  await computer.keyboard.press("Escape");

  await phone.locator("#submit").click();
  await phone.locator("#send-button").click();
  await computer
    .locator("#draft-head[hidden]")
    .waitFor({ ...poll, state: "attached" });
  const { payload } = (await s.action("read")).body.event;
  assert.deepEqual(
    payload.groups.notes.map((note) => note.text),
    ["Keep the logo for a beat."],
  );
  assert.equal(payload.groups.choices["overview/approach"].value, "batch");
  assert.equal((await s.publish(round("2"))).code, 200);
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

// A reviewer who stopped a video part way returns to the same place in it, so
// the frame does not draw that page again, and each component on it has to
// show the other device's change on the elements it already has.
test("a page whose video has started shows what another device completes, and keeps the video", async (t) => {
  const { session: s, url } = await session(t);
  const computer = await open(t, url);
  if (!computer) return;
  const phone = await open(t, url, { viewport: { width: 375, height: 812 } });
  const video = computer.locator("pair-thread video");
  await video.waitFor();
  await mark(computer);
  await video.evaluate(async (element) => {
    if (element.readyState < 1)
      await new Promise((resolve) =>
        element.addEventListener("loadedmetadata", resolve, { once: true }),
      );
    element.currentTime = 0.5;
  });

  await box(phone, "logs").check();
  await computer.locator(".scope-count", { hasText: "1 of 2" }).waitFor(poll);
  const limit = phone.locator('[data-question="limit"]');
  await limit.getByRole("textbox").fill("Three");
  await limit.getByRole("button", { name: "Answer" }).click();
  const answered = computer.locator('[data-question="limit"]');
  await answered.locator(".answer-text", { hasText: "Three" }).waitFor(poll);
  await answered.locator("[data-edit]").waitFor(poll);
  // Saving a real drawing needs the drawing editor, which
  // tests/browser/drawing.browser.mjs covers, so this device's change arrives
  // the way a saved drawing does.
  const saved = await s.request(`${s.base}/api/draft`, {
    changes: {
      "answer/overview/endcard": {
        topic: "overview",
        label: "End card",
        kind: "drawing",
        round: "1",
        sceneId: "scene",
        previewId: "preview",
      },
    },
  });
  assert.equal(saved.code, 200, saved.body.error);
  const drawn = computer.locator('[data-drawing-question="endcard"]');
  await drawn.locator("[data-draw]", { hasText: "Edit drawing" }).waitFor(poll);
  assert.equal(await drawn.locator(".drawing-preview").isHidden(), false);

  // The phone changes its answer, and the card follows the new text.
  await limit.locator("[data-edit]").click();
  await limit.getByRole("textbox").fill("Four");
  await limit.getByRole("button", { name: "Answer" }).click();
  await answered.locator(".answer-text", { hasText: "Four" }).waitFor(poll);

  assert.equal(await kept(computer), true);
  assert.equal(await video.evaluate((element) => element.currentTime), 0.5);
});

// Two tabs of one browser save one copy of the draft in localStorage. Each
// change one tab saves reaches the other, and the frame must not draw the
// page under the reviewer while they type, or let the two tabs keep
// rewriting the draft.
test("two tabs of a session converge, and typing in one tab is never disturbed by the other", async (t) => {
  const { url, draft } = await session(t);
  // open() makes a page in a context of its own, and a second page there
  // has to be in a context made with newContext().
  const blank = await open(t, "about:blank");
  if (!blank) return;
  const context = await blank.context().browser().newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto(url);
  await second.goto(url);
  await reply(first).waitFor();
  await reply(second).waitFor();
  await mark(first);
  // writes() counts the drafts that each tab loads from the other.
  const writes = (page) =>
    page.evaluate(() => {
      window.writes = 0;
      addEventListener("storage", () => window.writes++);
    });

  // The first tab types a note while the second makes a choice.
  const note = "Cut the final launch video to fifteen seconds.";
  await first.getByRole("button", { name: "Comment on the result" }).click();
  await Promise.all([
    first.locator("#note-text").pressSequentially(note, { delay: 60 }),
    sleep(800).then(() => button(second, "queue").click()),
  ]);
  assert.equal(await first.locator("#note-text").inputValue(), note);
  assert.equal(await kept(first), true);
  assert.equal(JSON.stringify(await draft()).includes(note), false);
  await first.getByRole("button", { name: "Add to feedback" }).click();
  await first.locator("#note-dialog").waitFor({ state: "hidden" });
  await pressed(first, "queue");

  // The first tab types a reply while the second ticks a box.
  await mark(first);
  const text = "The cut at 0:12 is too abrupt, hold the logo a beat longer.";
  await reply(first).click();
  await Promise.all([
    reply(first).pressSequentially(text, { delay: 60 }),
    sleep(800).then(() => box(second, "logs").check()),
  ]);
  assert.equal(await reply(first).inputValue(), text);
  assert.equal(
    await reply(first).evaluate((field) => field === document.activeElement),
    true,
  );
  assert.equal(await kept(first), true);
  assert.equal(await box(first, "logs").isChecked(), true);

  // Both tabs show the same choice, tick and note, the hub has them, and
  // neither tab writes the draft again.
  for (const page of [first, second]) {
    await pressed(page, "queue");
    assert.equal(await box(page, "logs").isChecked(), true);
  }
  await settled(draft);
  const { items } = await draft();
  assert.equal(items["choice/overview/approach"].value.value, "queue");
  assert.equal(items["choice/overview/scope"].value.options[0].checked, true);
  assert.equal(
    Object.values(items).filter((item) => item.value?.text === note).length,
    1,
  );
  assert.equal(JSON.stringify(items).includes(text), false);
  await Promise.all([writes(first), writes(second)]);
  await sleep(4500);
  for (const page of [first, second])
    assert.equal(await page.evaluate(() => window.writes), 0);
});
