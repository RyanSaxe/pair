import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

const card = (id, title) => ({
  id,
  title,
  delivers: `${title}, delivered.`,
  recommend: "here",
});
// work publishes round 1, which waits for the reviewer, proposes two cards, the
// first from round 1's Overview page, and opens Work.
async function work(t) {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  for (const [id, title, page] of [
    ["deck", "Build the deck", "1/overview"],
    ["export", "Refresh the export"],
  ]) {
    const added = await session.action("propose", { ...card(id, title), page });
    assert.equal(added.code, 200, added.body.error);
  }
  const page = await open(t, `${h.server.origin}${session.base}/#work`);
  const tab = (id) => page.locator(`#work-tab-${id}`);
  const cards = async () =>
    (await session.status()).body.proposals.map(
      ({ id, started, declined }) => ({
        id,
        started: started?.where || null,
        declined: Boolean(declined),
      }),
    );
  return { session, page, tab, cards };
}

const workRow = (page) =>
  page.locator("#work-row").evaluate((row) => {
    const count = (kind) => {
      const mark = row.querySelector(`.count.${kind}`);
      return mark && !mark.hidden ? [mark.textContent, mark.title] : null;
    };
    return {
      label: row.getAttribute("aria-label"),
      needs: count("needs"),
      proposed: count("proposed"),
    };
  });

test("Start sends where the work runs and the message, and the running card quotes the message", async (t) => {
  const { session, page, tab, cards } = await work(t);
  if (!page) return;
  await page
    .locator("#work-tab-proposed[aria-selected=true]")
    .waitFor({ timeout: 8000 });
  assert.deepEqual(await workRow(page), {
    label: "Work, 2 proposed",
    needs: null,
    proposed: ["2", "2 proposed"],
  });
  const from = page.locator("[data-proposal-card=deck] .card-meta a");
  assert.equal(await from.textContent(), "From the Overview page");
  assert.equal(await from.getAttribute("href"), "#overview");
  await page.locator("[data-proposal-card=deck] .proposal-start").click();
  const dialog = page.locator("#start-dialog");
  await dialog.locator("#start-title", { hasText: "Build the deck" }).waitFor();
  assert.equal(
    await dialog.locator("#start-delivers").textContent(),
    "Build the deck, delivered.",
  );
  assert.doesNotMatch(await dialog.textContent(), /Delivers|May change/);
  assert.equal(
    await dialog.locator("[data-where=here]").getAttribute("aria-checked"),
    "true",
  );
  await dialog.locator("#start-message").fill("Keep the header height.");
  await dialog.locator("#start-message").press("Shift+Enter");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await waitUntil(async () => (await cards())[0].started === "here"),
    true,
  );
  const status = (await session.status()).body;
  assert.equal(status.proposals[0].started.message, "Keep the header height.");
  await tab("running").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("proposed").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("running").click();
  await page
    .locator("[data-proposal-card=deck] .card-state", { hasText: "Working" })
    .waitFor();
  // The frame shows the reviewer's Start message on the card, so the card shows
  // everything the reviewer approved.
  assert.equal(
    await page
      .locator("[data-proposal-card=deck] .proposal-message")
      .textContent(),
    "“Keep the header height.”",
  );
  assert.equal(new URL(page.url()).hash, "#work");
});

// The reviewer answers a round only with Send feedback, so starting a card must
// leave the waiting round and its drafts in place.
test("Start here leaves the waiting round open with its drafts, so a second card can start", async (t) => {
  const { session, page, tab } = await work(t);
  if (!page) return;
  await page.locator('#page-list [data-page="overview"]').click();
  await page.locator("#comment-here").click();
  await page.locator("#note-text").fill("Keep the header height.");
  await page.getByRole("button", { name: "Add to feedback" }).click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  await page.locator("#work-row").click();
  const dialog = page.locator("#start-dialog");
  for (const id of ["deck", "export"]) {
    await tab("proposed").click();
    await page.locator(`[data-proposal-card=${id}] .proposal-start`).click();
    await dialog.locator("#start-send").click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal((await session.status()).body.needsYou, true);
    const read = (await session.action("read")).body;
    assert.equal(read.moment, "read-start-here");
    assert.equal(read.event.payload.proposal, id);
    assert.equal((await session.status()).body.needsYou, true);
  }
  await tab("running").locator(".work-count", { hasText: "2" }).waitFor();
  assert.equal(await tab("needs").locator(".work-count").textContent(), "0");
  await tab("running").click();
  for (const id of ["deck", "export"])
    assert.equal(
      await page.locator(`[data-proposal-card=${id}] .card-meta`).textContent(),
      "Working here",
    );
  await page.locator("#review-row").click();
  await page
    .locator("#feedback-groups", { hasText: "Keep the header height." })
    .waitFor();
  assert.equal(await page.locator("#submit").isEnabled(), true);
  // The frame never writes a round in the line under a card's title, even after
  // the card is done.
  const done = await session.action("propose", { id: "deck", done: true });
  assert.equal(done.code, 200, done.body.error);
  await page.locator("#work-row").click();
  await tab("done").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("done").click();
  assert.doesNotMatch(
    await page.locator("[data-proposal-card=deck] .card-meta").textContent(),
    /round/i,
  );
});

test("a proposed card keeps its meta line and its buttons to one row each on a phone", async (t) => {
  const { session, page } = await work(t);
  if (!page) return;
  const title =
    "Merge the ten 0.3 pull requests into develop in order and release 0.3 to npm";
  const revised = await session.action("propose", {
    id: "deck",
    revise: true,
    title,
  });
  assert.equal(revised.code, 200, revised.body.error);
  await page.setViewportSize({ width: 390, height: 844 });
  const deck = page.locator("[data-proposal-card=deck]");
  await deck.locator(".proposal-title", { hasText: title }).waitFor();
  const rows = await deck.evaluate((root) => {
    const box = (node) => node.getBoundingClientRect();
    const line = (selector) =>
      [...root.querySelectorAll(selector)].map((node) => [
        node.textContent,
        box(node).top + box(node).height / 2,
      ]);
    return {
      title: box(root.querySelector(".proposal-title")).bottom,
      metaTop: box(root.querySelector(".card-meta")).top,
      meta: line(".card-meta > :not(.state-dot)"),
      foot: line(".proposal-foot :not(:has(*))"),
    };
  });
  // The test counts items whose vertical middles are within 2px of each other
  // as one row.
  for (const name of ["meta", "foot"]) {
    const middles = rows[name].map(([, middle]) => middle);
    assert.ok(
      Math.max(...middles) - Math.min(...middles) <= 2,
      `${name} is one row: ${JSON.stringify(rows[name])}`,
    );
  }
  assert.ok(rows.metaTop >= rows.title, "the meta line is under the title");
  assert.deepEqual(
    rows.meta.map(([text]) => text),
    ["Proposed", "·", "From the Overview page"],
  );
  assert.deepEqual(
    rows.foot.map(([text]) => text),
    ["Decline", "Start"],
  );
});

test("the Start popup keeps one size and one row of buttons", async (t) => {
  const { session, page } = await work(t);
  if (!page) return;
  const added = await session.action("propose", {
    ...card("flow", "Redraw the example flow diagram for the fluid model"),
    delivers:
      "guide/flow.svg and its copy in the test fixture drawing rounds, proposals, Start and closing, with no Accept or offers.",
    recommend: "sub-session",
  });
  assert.equal(added.code, 200, added.body.error);
  const rows = {
    here: ["#start-send"],
    "sub-session": ["#start-send"],
    "new-agent": ["#start-copy", "#start-open"],
  };
  for (const [width, height] of [
    [1280, 800],
    [375, 664],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator("[data-proposal-card=flow] .proposal-start").click();
    const dialog = page.locator("#start-dialog");
    await dialog
      .locator("#start-title", { hasText: "Redraw the example flow" })
      .waitFor();
    const boxes = [];
    for (const where of ["here", "sub-session", "new-agent", "here"]) {
      await dialog.locator(`[data-where=${where}]`).click();
      assert.equal(
        await dialog
          .locator(`[data-where=${where}]`)
          .getAttribute("aria-checked"),
        "true",
      );
      boxes.push(await dialog.boundingBox());
      const buttons = await Promise.all(
        rows[where].map((id) => dialog.locator(id).boundingBox()),
      );
      const copy = await dialog.locator("#start-copy").boundingBox();
      for (const button of buttons) {
        assert.equal(button.y, buttons[0].y, `${where} at ${width}px`);
        assert.equal(button.height, copy.height, `${where} at ${width}px`);
      }
    }
    for (const box of boxes) assert.deepEqual(box, boxes[0], `at ${width}px`);
    await dialog.locator("[data-where=new-agent]").click();
    assert.equal(await dialog.locator("#start-open").isVisible(), true);
    assert.equal(await dialog.locator("#start-send").isVisible(), false);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
});

test("Open a new agent session starts the card with a new agent and shows its thread", async (t) => {
  const { session, page, cards } = await work(t);
  if (!page) return;
  await page.locator("[data-proposal-card=export] .proposal-start").click();
  const dialog = page.locator("#start-dialog");
  await dialog.locator("[data-where=new-agent]").click();
  await dialog.locator("#start-message").fill("Use the board template.");
  await dialog.locator("#start-message").press("Shift+Enter");
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual((await cards())[1].started, "new-agent");
  await page
    .locator("[data-proposal-card=export] .card-state", {
      hasText: "Opening a new agent session",
    })
    .waitFor({ timeout: 5000 });
  await page
    .locator("pair-thread", { hasText: "Use the board template." })
    .waitFor({ timeout: 5000 });
  const { threads } = (await session.status()).body;
  assert.equal(threads[0].kind, "open-agent");
});

// After the round's feedback is sent, the comment control only starts threads,
// so Shift+Enter types a new line.
test("the comment control comments on a chosen card, the proposal component, Work and Review", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const data = planData();
  data.pages[0].html +=
    '<div class="proposal" data-proposal="deck" data-kind="proposal"><p><b>Build the deck</b></p></div>';
  assert.equal((await session.publish(data)).code, 200);
  for (const [id, title] of [
    ["deck", "Build the deck"],
    ["export", "Refresh the export"],
  ]) {
    const added = await session.action("propose", card(id, title));
    assert.equal(added.code, 200, added.body.error);
  }
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const named = (label) =>
    page.locator(`#comment-here[aria-label="${label}"]`).waitFor();
  const comment = async (label, text, button) => {
    await named(label);
    await page.locator("#comment-here").click();
    await page.locator("#note-text").fill(text);
    await page.getByRole("button", { name: button }).click();
    await page.locator("#note-dialog").waitFor({ state: "hidden" });
  };
  await page.locator("#page-content .proposal-delivers").click();
  await comment(
    "Comment on this proposal",
    "Build it first.",
    "Add to feedback",
  );

  await page.locator("#work-row").click();
  await comment("Comment on Work", "Which ships first?", "Start a thread");
  await page
    .locator("#work-threads pair-thread", { hasText: "Which ships first?" })
    .waitFor();
  const exported = page.locator("#work-cards [data-proposal-card=export]");
  await exported.locator(".proposal-delivers").click();
  await comment(
    "Comment on this proposal",
    "Keep the columns.",
    "Start a thread",
  );
  await exported
    .locator("+ pair-thread", { hasText: "Keep the columns." })
    .waitFor();
  await page.keyboard.press("j");
  await named("Comment on this proposal");
  await page.keyboard.press("c");
  await page
    .locator("#note-anchor", { hasText: "Work › Build the deck" })
    .waitFor();
  await page.locator("#note-text").fill("Start it before the export.");
  await page.keyboard.press("Shift+Enter");
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
  const threads = async () =>
    (await session.status()).body.threads.map(({ topic, proposal }) => [
      topic ?? proposal,
    ]);
  assert.equal(
    await waitUntil(async () => (await threads()).length === 2),
    true,
  );
  assert.deepEqual(await threads(), [["work"], ["export"]]);

  await page.locator("#review-row").click();
  assert.equal(await page.locator("#overall-group").isVisible(), false);
  await comment("Add overall comment", "Ship it.", "Add to feedback");
  await page.locator("#overall-group", { hasText: "Ship it." }).waitFor();
  assert.deepEqual(
    await page.locator("#feedback-review h2").allTextContents(),
    ["Your feedback", "Overview", "Work", "Overall"],
  );
  await page.locator("#submit").click();
  await page.locator("#send-button").click();
  assert.equal(
    await waitUntil(
      async () => (await session.status()).body.latestSubmissionId,
    ),
    true,
  );
  const { event } = (await session.action("read")).body;
  assert.deepEqual(
    event.payload.groups.notes.map(({ topic, anchor, proposal }) => [
      topic,
      anchor,
      proposal,
    ]),
    [
      ["overview", "Build the deck", "deck"],
      ["work", "Build the deck", "deck"],
      ["overall", "Overall feedback", undefined],
    ],
  );

  await page.locator("#work-row").click();
  await named("Comment on Work");
  await page.locator("#comment-here").click();
  assert.equal(await page.locator("#note-save").isVisible(), false);
  const text = page.locator("#note-text");
  await text.fill("Keep the header height.");
  await text.press("Shift+Enter");
  await page.keyboard.type("Drop the footer.");
  assert.equal(
    await text.inputValue(),
    "Keep the header height.\nDrop the footer.",
  );
});

test("Decline takes a card out of Proposed, and Restore puts it back", async (t) => {
  const { page, tab, cards } = await work(t);
  if (!page) return;
  const proposed = page.locator("#work-cards [data-proposal-card]");
  await proposed.nth(1).waitFor({ timeout: 8000 });
  await page
    .locator("[data-proposal-card=export] .link-btn", { hasText: "Decline" })
    .click();
  await tab("proposed").locator(".work-count", { hasText: "1" }).waitFor();
  assert.deepEqual(
    await proposed.evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.proposalCard),
    ),
    ["deck"],
  );
  assert.deepEqual(
    (await cards()).map(({ id, declined }) => [id, declined]),
    [
      ["deck", false],
      ["export", true],
    ],
  );
  await tab("done").click();
  await page
    .locator("[data-proposal-card=export] .link-btn", { hasText: "Restore" })
    .click();
  await tab("proposed").locator(".work-count", { hasText: "2" }).waitFor();
  assert.equal((await cards())[1].declined, false);
});

test("a card started on the reviewer's words quotes them and links to where they wrote them", async (t) => {
  const { session, page, tab } = await work(t);
  if (!page) return;
  await tab("proposed").locator(".work-count", { hasText: "2" }).waitFor();
  const started = await session.action("propose", {
    id: "deck",
    start: "here",
    quote: "Build the deck now.\nKeep the header height.",
    page: "1/overview",
  });
  assert.equal(started.code, 200, started.body.error);
  await tab("running").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("running").click();
  const card = page.locator("[data-proposal-card=deck]");
  await card.waitFor();
  assert.equal(await card.locator(".card-meta").textContent(), "Working here");
  const lead = card.locator(".proposal-lead");
  assert.equal(
    await lead.textContent(),
    "Started from your words on the Overview page",
  );
  assert.equal(await lead.locator("a").getAttribute("href"), "#overview");
  assert.equal(
    await card.locator(".proposal-message").innerText(),
    "“Build the deck now.\nKeep the header height.”",
  );
  assert.equal(await card.locator(".proposal-foot").count(), 0);
});

// The frame lists each card the agent joined into a proposed card, on the card
// and in its Start popup, so the reviewer sees all the work that Start begins.
test("a proposed card and its Start popup list the cards joined into it", async (t) => {
  const { session, page, tab } = await work(t);
  if (!page) return;
  await tab("proposed").locator(".work-count", { hasText: "2" }).waitFor();
  const added = await session.action("propose", card("notes", "Write notes"));
  assert.equal(added.code, 200, added.body.error);
  const joined = await session.action("propose", {
    id: "export",
    join: "deck",
  });
  assert.equal(joined.code, 200, joined.body.error);
  const deck = page.locator("[data-proposal-card=deck]");
  const listed = (box) => box.locator(":is(p, li)").allTextContents();
  await deck.locator(".proposal-joined").waitFor();
  assert.deepEqual(await listed(deck.locator(".proposal-joined")), [
    "Joined into this proposal",
    "Refresh the export",
  ]);
  const dialog = page.locator("#start-dialog");
  await deck.locator(".proposal-start").click();
  await dialog.locator("#start-title", { hasText: "Build the deck" }).waitFor();
  assert.deepEqual(await listed(dialog.locator("#start-joined")), [
    "Joined into this proposal",
    "Refresh the export",
  ]);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.locator("[data-proposal-card=notes] .proposal-start").click();
  await dialog.locator("#start-title", { hasText: "Write notes" }).waitFor();
  assert.equal(await dialog.locator("#start-joined").isVisible(), false);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await deck.locator(".proposal-start").click();
  await dialog.locator("#start-send").click();
  await dialog.waitFor({ state: "hidden" });
  await deck.locator(".card-state", { hasText: "Working here" }).waitFor();
  assert.deepEqual(await listed(deck.locator(".proposal-joined")), [
    "Joined into this proposal",
    "Refresh the export",
  ]);
  await tab("done").click();
  const exported = page.locator("[data-proposal-card=export]");
  assert.equal(
    await exported.locator(".card-meta").textContent(),
    "Done·Joined Build the deck",
  );
  assert.equal(await exported.locator(".proposal-foot").count(), 0);
});

test("a withdrawn card shows the agent's reason and Restore brings it back, and a card done elsewhere says where", async (t) => {
  const { session, page, tab, cards } = await work(t);
  if (!page) return;
  await tab("proposed").locator(".work-count", { hasText: "2" }).waitFor();
  const reason = "The deck moved to the board template.";
  for (const change of [
    { id: "deck", withdraw: true, reason },
    { id: "export", done: true, where: "in #86" },
  ]) {
    const changed = await session.action("propose", change);
    assert.equal(changed.code, 200, changed.body.error);
  }
  await tab("done").locator(".work-count", { hasText: "2" }).waitFor();
  await tab("done").click();
  const deck = page.locator("[data-proposal-card=deck]");
  await deck.waitFor();
  assert.equal(
    await deck.locator(".card-meta").textContent(),
    "Withdrawn·From the Overview page",
  );
  assert.equal(
    await deck.locator(".proposal-reason").textContent(),
    `The agent's reason: ${reason}`,
  );
  const exported = page.locator("[data-proposal-card=export]");
  assert.equal(
    await exported.locator(".card-meta").textContent(),
    "Done·in #86",
  );
  assert.equal(await exported.locator(".proposal-foot").count(), 0);
  await deck.locator(".link-btn", { hasText: "Restore" }).click();
  await tab("proposed").locator(".work-count", { hasText: "1" }).waitFor();
  assert.equal((await session.status()).body.proposals[0].withdrawn, null);
  assert.deepEqual(
    (await cards()).map(({ id, declined }) => [id, declined]),
    [
      ["deck", false],
      ["export", false],
    ],
  );
});

test("a running card shows the agent's status, folded on a phone until tapped", async (t) => {
  const { session, page, tab } = await work(t);
  if (!page) return;
  for (const id of ["deck", "export"]) {
    const started = await session.request(
      `${session.base}/api/proposals/${id}/start`,
      { where: "here" },
    );
    assert.equal(started.code, 200, started.body.error);
  }
  const status = async (done, left, drop) => {
    const written = await session.action("propose", {
      id: "deck",
      statusDone: done,
      statusLeft: left,
      statusDrop: drop,
    });
    assert.equal(written.code, 200, written.body.error);
  };
  await status(["Outline"], ["Outline", "Slides", "Speaker notes"]);
  const box = page.locator("[data-proposal-card=deck] .proposal-status");
  const parts = () =>
    box
      .locator("li")
      .evaluateAll((items) =>
        items
          .filter((item) => item.checkVisibility())
          .map((item) => [
            item.querySelector("[role=img]").getAttribute("aria-label"),
            item.textContent,
          ]),
      );
  const summary = box.locator("summary");
  const opened = async () => {
    await tab("running").click();
    await box.waitFor();
  };
  await tab("running").locator(".work-count", { hasText: "2" }).waitFor();
  await opened();
  assert.equal(await summary.textContent(), "1 of 3 done·Next: Slides");
  assert.equal(await summary.innerText(), "1 of 3 done");
  assert.deepEqual(await parts(), [
    ["Done", "Outline"],
    ["Left", "Slides"],
    ["Left", "Speaker notes"],
  ]);
  assert.equal(
    await page
      .locator("[data-proposal-card=export] .proposal-status")
      .textContent(),
    "No status from the agent yet",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await opened();
  assert.deepEqual(await parts(), []);
  assert.match(await summary.innerText(), /^1 of 3 done\s*·\s*Next: Slides$/);
  await summary.click();
  assert.equal((await parts()).length, 3);
  await status(["Handout"], ["Handout"], ["Slides"]);
  await summary.filter({ hasText: "2 of 3 done" }).waitFor();
  assert.equal(await summary.textContent(), "2 of 3 done·Next: Speaker notes");
  assert.deepEqual(await parts(), [
    ["Done", "Outline"],
    ["Dropped", "Slides"],
    ["Left", "Speaker notes"],
    ["Done", "Handout"],
  ]);
  assert.equal(await tab("running").locator(".work-count").textContent(), "2");

  const done = await session.action("propose", { id: "deck", done: true });
  assert.equal(done.code, 200, done.body.error);
  await tab("done").locator(".work-count", { hasText: "1" }).waitFor();
  await tab("done").click();
  await page.locator("[data-proposal-card=deck]").waitFor();
  assert.equal(await box.count(), 0);
});

// The frame marks a card as seen only when Work shows it. A page's proposal
// component also shows the New label, but the frame does not mark the card seen
// there.
test("a card reads New until Work shows it", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const data = planData();
  data.pages[0].html +=
    '<div class="proposal" data-proposal="fresh" data-kind="proposal"><p><b>Fresh</b></p><p>Fresh work.</p></div>';
  assert.equal((await session.publish(data)).code, 200);
  const record = async (fields) => {
    const added = await session.action("propose", fields);
    assert.equal(added.code, 200, added.body.error);
  };
  // A card that the agent proposed before this browser first loaded the session
  // is not New in this browser.
  await record(card("deck", "Build the deck"));
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  await page
    .locator("#work-row[aria-label='Work, 1 proposed']")
    .waitFor({ timeout: 8000 });
  await record(card("fresh", "Fresh work"));
  const label = (where) =>
    page.locator(`${where} [data-proposal-card=fresh] .page-new`);
  await label("#page-content").waitFor({ timeout: 8000 });
  assert.equal(await label("#page-content").textContent(), "New");
  const size = (where) =>
    page
      .locator(`${where} [data-proposal-card=fresh] .proposal-delivers`)
      .evaluate((node) => getComputedStyle(node).fontSize);
  const inPage = await size("#page-content");
  await record(card("gone", "Gone work"));
  await record({ id: "gone", withdraw: true, reason: "Not needed." });

  await page.locator("#work-row").click();
  await label("#work-cards").waitFor();
  assert.equal(inPage, await size("#work-cards"));
  assert.equal(
    await page
      .locator("#work-cards [data-proposal-card=deck] .page-new")
      .count(),
    0,
  );
  await page.waitForFunction(() =>
    (JSON.parse(localStorage.getItem("pair:cards:seen")) || []).some((key) =>
      key.endsWith("/fresh"),
    ),
  );
  await page.locator("#work-tab-done").click();
  await page.locator("#work-cards [data-proposal-card=gone]").waitFor();
  assert.equal(await page.locator("#work-cards .page-new").count(), 0);
  await page.locator("#work-tab-proposed").click();
  await label("#work-cards").waitFor();

  await page.locator('#page-list [data-page="overview"]').click();
  await page.locator("#page-content .proposal-card").waitFor();
  assert.equal(await label("#page-content").count(), 0);
  await page.locator("#work-row").click();
  await page.locator("#work-cards [data-proposal-card=fresh]").waitFor();
  assert.equal(await label("#work-cards").count(), 0);
});

test("Work opens on Needs you when a card's sub-session waits for the reviewer", async (t) => {
  const h = await hub(t);
  const parent = await h.session({ start: true });
  assert.equal((await parent.publish(planData())).code, 200);
  const added = await parent.action("propose", {
    ...card("deck", "Build the deck"),
    recommend: "sub-session",
  });
  assert.equal(added.code, 200, added.body.error);
  const proposed = await parent.action(
    "propose",
    card("export", "Refresh the export"),
  );
  assert.equal(proposed.code, 200, proposed.body.error);
  const started = await parent.request(
    `${parent.base}/api/proposals/deck/start`,
    { where: "sub-session" },
  );
  assert.equal(started.code, 200, started.body.error);
  const child = await h.session({
    start: true,
    from: parent.directory,
    proposal: "deck",
  });
  assert.equal((await child.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${parent.base}/#work`);
  if (!page) return;
  // The frame counts the card as running until the session list shows that its
  // sub-session waits for the reviewer, so the test waits for Work to select
  // Needs you.
  await page.locator('#work-tab-needs[aria-selected="true"]').waitFor();
  await page
    .locator("#work-cards [data-proposal-card=deck]")
    .waitFor({ timeout: 5000 });
  assert.deepEqual(await workRow(page), {
    label: "Work, 1 needs you, 1 proposed",
    needs: ["1", "1 needs you"],
    proposed: ["1", "1 proposed"],
  });
  const edges = await page.locator("#work-row").evaluate((row) => {
    const box = (kind) =>
      row.querySelector(`.count.${kind}`).getBoundingClientRect();
    return {
      rowEnd:
        row.getBoundingClientRect().right -
        parseFloat(getComputedStyle(row).paddingRight),
      needs: box("needs"),
      proposed: box("proposed"),
    };
  });
  assert.ok(
    edges.proposed.right < edges.needs.left,
    `the proposed number ends at ${edges.proposed.right}, the pill starts at ${edges.needs.left}`,
  );
  assert.equal(Math.round(edges.needs.right), Math.round(edges.rowEnd));
});
