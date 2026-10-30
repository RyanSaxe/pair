import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep, waitUntil } from "../support/hub.mjs";

const choices = (page) =>
  page
    .locator("#send-choices [data-next]")
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.dataset.next,
        row.querySelector(".start-choice").textContent,
        row.getAttribute("aria-checked"),
      ]),
    );
async function openPopup(page) {
  await page.locator("#submit").click();
  await page.locator("#send-dialog[open]").waitFor();
}
async function sent(session) {
  assert.equal(
    await waitUntil(
      async () => (await session.status()).body.latestSubmissionId,
    ),
    true,
  );
  return (await session.action("read")).body.event.payload;
}

test("Send feedback opens a popup that starts on Keep iterating and sends the choice and the message", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#feedback`);
  if (!page) return;
  await openPopup(page);
  assert.deepEqual(await choices(page), [
    ["iterate", "Keep iterating", "true"],
    ["plan", "Write a plan", "false"],
    ["build", "Build it", "false"],
  ]);
  const button = page.locator("#send-button");
  assert.equal(await page.locator("#send-label").textContent(), "Send");
  // With no comments, the switch off and no message, the first choice has
  // nothing to send, so the frame disables Send. Any other choice enables it.
  await page.locator("#align-unflagged").click();
  assert.equal(await button.isDisabled(), true);
  await page.locator('#send-choices [data-next="build"]').click();
  assert.equal(await button.isEnabled(), true);
  assert.equal(await page.locator("#send-label").textContent(), "Build it");
  await page.keyboard.press("ArrowUp");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.next),
    "plan",
  );
  assert.equal(await page.locator("#send-label").textContent(), "Send");
  await page.locator("#send-message").fill("Show the plan in two pages.");
  await page.locator("#send-message").press("Shift+Enter");
  await page.locator("#send-dialog").waitFor({ state: "hidden" });
  const payload = await sent(session);
  assert.equal(payload.next, "plan");
  assert.equal(payload.message, "Show the plan in two pages.");
  assert.equal(payload.groups.alignUnflagged, false);
});

const withChoice = (round) => {
  const data = planData(round);
  data.pages[0].html = `<div data-choice="approach" data-label="Approach">
    <button type="button" data-value="queue">Queue</button>
    <button type="button" data-value="retry">Retry</button>
  </div>`;
  return data;
};
async function openRound(t, options) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(withChoice("1"))).code, 200);
  const page = await open(
    t,
    `${h.server.origin}${session.base}/#overview`,
    options,
  );
  if (page) await page.locator('[data-choice="approach"]').waitFor();
  return { session, page };
}
// A status poll can show another browser's send while this browser's request
// is on its way to the hub, which then refuses it.
async function refusedSend(page, session, message) {
  const other = session.event();
  await page.route("**/api/feedback", async (route) => {
    assert.equal((await session.feedback(other)).code, 200);
    await page.waitForResponse(
      async (response) =>
        response.url().endsWith("/api/status") &&
        (await response.json()).latestSubmissionId === other.id,
    );
    await sleep(100);
    await route.continue();
  });
  await openPopup(page);
  if (message) await page.locator("#send-message").fill(message);
  const refusal = page.waitForResponse("**/api/feedback");
  await page.locator("#send-button").click();
  const refused = await refusal;
  assert.equal(refused.status(), 409);
  await page.locator("#save-error-text").waitFor();
  return { other, reason: (await refused.json()).error };
}
const nextRound = async (page, session) => {
  assert.equal((await session.publish(withChoice("2"))).code, 200);
  await page.locator('#round[aria-label="Rounds, on round 2"]').waitFor({
    state: "attached",
  });
};
const asMessage = (page) =>
  page.getByRole("button", { name: "Send as a message" });

test("a send the hub refuses shows the hub's reason, and the message stays in the draft for the next round", async (t) => {
  const { session, page } = await openRound(t);
  if (!page) return;
  const { other, reason } = await refusedSend(
    page,
    session,
    "Sent from the phone.",
  );
  const banner = page.locator("#save-error-text");
  assert.equal(await banner.textContent(), reason);
  // The reviewer has not seen the reason until they dismiss it, so the status
  // polls that show the round as sent leave it.
  await page.locator("#submit:disabled").waitFor();
  await page.waitForResponse("**/api/status");
  assert.equal(await banner.textContent(), reason);
  assert.equal((await session.action("read")).body.event.id, other.id);
  await nextRound(page, session);
  await openPopup(page);
  assert.equal(
    await page.locator("#send-message").inputValue(),
    "Sent from the phone.",
  );
});

for (const [width, viewport] of [
  ["a wide window", { width: 1280, height: 800 }],
  ["375px", { width: 375, height: 740 }],
])
  test(`Send as a message at ${width} starts a progress thread, and only the message leaves the draft`, async (t) => {
    const { session, page } = await openRound(t, { viewport });
    if (!page) return;
    await page.locator('[data-value="queue"]').click();
    const { other } = await refusedSend(page, session, "Sent from the phone.");
    await asMessage(page).click();
    await page.locator("#save-error").waitFor({ state: "hidden" });
    assert.equal(
      await waitUntil(
        async () => (await session.status()).body.threads.length === 1,
      ),
      true,
    );
    const status = (await session.status()).body;
    const [thread] = status.threads;
    assert.deepEqual(
      [thread.topic, thread.anchor, thread.target, thread.round],
      ["agreed", "Progress", "agent-activity", "1"],
    );
    assert.equal(thread.messages[0].text, "Sent from the phone.");
    assert.equal(status.latestSubmissionId, other.id);
    const read = (await session.action("read")).body;
    assert.equal(read.event.id, other.id);
    assert.deepEqual(
      read.threads.map((item) => item.id),
      [thread.id],
    );
    await nextRound(page, session);
    await page.reload();
    await page.locator("#submit", { hasText: "(1)" }).waitFor();
    await openPopup(page);
    assert.equal(await page.locator("#send-message").inputValue(), "");
  });

test("a refused send with no typed message does not offer Send as a message", async (t) => {
  const { session, page } = await openRound(t);
  if (!page) return;
  await refusedSend(page, session);
  assert.equal(await asMessage(page).count(), 0);
});

test("the message stays in the draft when the hub never receives Send as a message", async (t) => {
  const { session, page } = await openRound(t);
  if (!page) return;
  await refusedSend(page, session, "Sent from the phone.");
  await page.route("**/api/threads", (route) => route.abort("connectionreset"));
  const failed = page.waitForEvent("requestfailed");
  await asMessage(page).click();
  await failed;
  await session.action("read");
  await nextRound(page, session);
  await page.reload();
  await page.locator("#submit").waitFor();
  await openPopup(page);
  assert.equal(
    await page.locator("#send-message").inputValue(),
    "Sent from the phone.",
  );
});

test("the error from a lost response clears once a status poll shows the hub saved the send", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/`);
  if (!page) return;
  await page.locator("#page-title", { hasText: "Agreed so far" }).waitFor();
  await page.route("**/api/feedback", async (route) => {
    await route.fetch();
    await route.abort("connectionreset");
  });
  // The frame recovers from a poll during the send without showing the error,
  // so the test holds the polls until the error appears.
  let polling = false;
  await page.route("**/api/status", async (route) => {
    await waitUntil(() => polling);
    await route.continue();
  });
  await openPopup(page);
  await page.locator("#send-message").fill("Sent before the hub answered.");
  await page.locator("#send-button").click();
  const banner = page.locator("#save-error");
  await banner.waitFor();
  assert.equal(await asMessage(page).count(), 0);
  polling = true;
  await banner.waitFor({ state: "hidden" });
  await page.locator("#submit:disabled").waitFor();
  assert.equal((await session.status()).body.stage, "submitted");
});

// A question or a checklist that is a top-level block has its block's ID on
// the live page.
test("the links to a typed answer and a checklist land on them, also after a reload", async (t) => {
  const filler = Array.from(
    { length: 30 },
    (_, index) => `<p>Paragraph ${index + 1}.</p>`,
  ).join("");
  const data = planData();
  data.pages[0].html = `${filler}<section class="question" data-question="owner" data-label="Owner">
    <h3>Who owns the retries?</h3>
    <textarea aria-label="Your answer"></textarea>
    <div class="answer-actions"><button type="button" class="btn primary" data-answer>Answer</button></div>
  </section>${filler}<div class="scope-list" data-multiselect="scope" data-label="Scope">
    <label class="scope-row"><span><strong>Alerts</strong></span><input type="checkbox" class="scope-check" data-value="alerts" data-label="Alerts" /></label>
  </div>`;
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(data)).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`, {
    viewport: { width: 1280, height: 500 },
  });
  if (!page) return;
  const landed = async (selector) => {
    const found = page.locator(`${selector}:focus`);
    await found.waitFor();
    const { top, bottom } = await found.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    assert.ok(top >= 0 && bottom <= 500, `${selector} is at ${top}-${bottom}`);
  };
  const question = '[data-question="owner"]';
  const checklist = '[data-multiselect="scope"]';

  await page.locator(`${question} textarea`).fill("The payments team");
  await openPopup(page);
  await page.locator("#send-not-added-list a").click();
  await landed(question);

  await page.locator(`${checklist} input`).check();
  await page.reload();
  await page
    .locator(`${checklist} input:checked`)
    .waitFor({ state: "attached" });
  await page.locator("#review-row").click();
  await page
    .locator(".feedback-item", { hasText: "Alerts" })
    .getByRole("link", { name: "Edit on the page" })
    .click();
  await landed(checklist);

  const id = await page.locator(checklist).getAttribute("id");
  await openPopup(page);
  await page.locator("#send-button").click();
  assert.equal(
    (await sent(session)).groups.choices["overview/scope"].target,
    id,
  );
});

test("a plan round has the Plan tag and its own choices, and Review lists the choice sent", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/`);
  if (!page) return;
  await page.locator("#page-title", { hasText: "Agreed so far" }).waitFor();
  assert.equal(await page.locator("#page-title .tag").count(), 0);
  await openPopup(page);
  await page.locator('#send-choices [data-next="plan"]').click();
  await page.locator("#send-message").fill("Plan the retry.");
  await page.locator("#send-button").click();
  assert.equal((await sent(session)).next, "plan");
  assert.equal(
    (await session.publish({ ...planData("2"), plan: true })).code,
    200,
  );
  await page.locator("#page-title .tag.plan", { hasText: "Plan" }).waitFor();
  await page.locator("#round").click();
  const rows = page.locator("#round-list .sess-row");
  await rows.nth(1).waitFor();
  assert.deepEqual(
    await rows.evaluateAll((list) =>
      list.map((row) => [
        row.querySelector(".t").firstChild.textContent,
        row.querySelector(".tag")?.textContent ?? null,
      ]),
    ),
    [
      ["Round 2", "Plan"],
      ["Round 1", null],
    ],
  );
  await page.keyboard.press("Escape");
  await openPopup(page);
  assert.deepEqual(await choices(page), [
    ["plan", "Update the plan", "true"],
    ["iterate", "Back to iterating", "false"],
    ["build", "Build it", "false"],
  ]);
  await page.keyboard.press("Escape");
  await page.goto(`${h.server.origin}${session.base}/r/1#feedback`);
  const list = page.locator("#sent-feedback-list");
  await list.locator(".sent-card").first().waitFor();
  assert.deepEqual(
    await list
      .locator(".sent-card")
      .evaluateAll((cards) =>
        cards
          .slice(0, 2)
          .map((card) => [
            card.querySelector("small").textContent,
            card.querySelector("p").textContent,
          ]),
      ),
    [
      ["What comes next", "Write a plan"],
      ["Message to the agent", "Plan the retry."],
    ],
  );
});

// With Plan it first, the agent plans in the card's own session before it
// builds, so the frame disables Plan it first when Here is selected. The card
// shows Planning until the reviewer chooses Build it in that session.
test("Plan it first is off with Here, and its card reads Planning until its session chooses Build it", async (t) => {
  const h = await hub(t);
  const parent = await h.session({ start: true });
  assert.equal((await parent.publish(planData())).code, 200);
  const added = await parent.action("propose", {
    id: "deck",
    title: "Build the deck",
    delivers: "Build the deck, delivered.",
    recommend: "sub-session",
  });
  assert.equal(added.code, 200, added.body.error);
  const page = await open(t, `${h.server.origin}${parent.base}/#work`);
  if (!page) return;
  await page.locator("[data-proposal-card=deck] .proposal-start").click();
  const dialog = page.locator("#start-dialog");
  const box = dialog.locator("#start-plan-first");
  await dialog.locator("#start-title", { hasText: "Build the deck" }).waitFor();
  assert.equal(await box.isChecked(), false);
  await box.check();
  await dialog.locator("[data-where=here]").click();
  assert.deepEqual(
    [await box.isChecked(), await box.isDisabled()],
    [false, true],
  );
  await dialog.locator("[data-where=sub-session]").click();
  await box.check();
  await dialog.locator("#start-send").click();
  await dialog.waitFor({ state: "hidden" });
  const started = (await parent.status()).body.proposals[0].started;
  assert.deepEqual([started.where, started.planFirst], ["sub-session", true]);
  const child = await h.session({
    start: true,
    from: parent.directory,
    proposal: "deck",
  });
  const state = page.locator("[data-proposal-card=deck] .card-state");
  await page.locator("#work-tab-running").click();
  await state.filter({ hasText: "Planning in a sub-session" }).waitFor();
  // While the sub-session's plan round waits for the reviewer, the card reads
  // Waiting for you instead of Planning.
  assert.equal((await child.publish({ ...planData(), plan: true })).code, 200);
  await page.locator("#work-tab-needs").click();
  await state.filter({ hasText: "Waiting for you" }).waitFor();
  const built = await child.feedback(
    child.event("feedback-only", "1", { next: "build" }),
  );
  assert.equal(built.code, 200, built.body.error);
  await page.locator("#work-tab-running").click();
  await state.filter({ hasText: "Working" }).waitFor();
});

test("the Send popup links to a typed answer until Answer adds it", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const data = planData();
  data.pages[0].html = `<section class="question" data-question="limit" data-label="Retry limit" data-state="open">
  <h3>How many retries?</h3>
  <textarea rows="2" aria-label="Your answer"></textarea>
  <p class="answer-text" hidden></p>
  <div class="answer-actions"><button type="button" class="btn primary" data-answer>Answer</button><button type="button" class="btn" data-edit hidden>Edit</button></div>
</section>`;
  assert.equal((await session.publish(data)).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const question = page.locator('[data-question="limit"]');
  await question.getByRole("textbox").fill("Three");
  await openPopup(page);
  assert.equal(
    await page.locator("#send-not-added-count").textContent(),
    "1 typed answer is not added",
  );
  const link = page.locator("#send-not-added-list a");
  assert.equal(await link.textContent(), "Retry limit");
  await link.click();
  await page.locator("#send-dialog").waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).hash, "#overview");
  await question.getByRole("button", { name: /Answer/ }).click();
  await question.locator(".answer-text").waitFor({ state: "visible" });
  await openPopup(page);
  assert.equal(await page.locator("#send-not-added").isHidden(), true);
});
