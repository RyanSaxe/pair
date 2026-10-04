import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  hub,
  literal,
  planData,
  sleep,
  waitUntil,
} from "../../support/hub.mjs";

const card = {
  id: "churn-export",
  title: "Refresh the churn data export",
  delivers: "The export uses the September schema.",
  recommend: "here",
};
// A session with round 1 published and waiting for the reviewer. propose
// runs pair propose's action as the holder, and reviewer posts a card's
// route from the browser.
async function proposing(t) {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const propose = (fields, agent = a.agent) =>
    a.action("propose", { ...fields, agent });
  const add = async (fields = {}) => {
    const added = await propose({ ...card, ...fields });
    assert.equal(added.code, 200, added.body.error);
    return added.body.proposal;
  };
  const reviewer = (id, action, body = {}) =>
    a.request(`${a.base}/api/proposals/${id}/${action}`, body);
  const cards = async () => (await a.status()).body.proposals;
  const read = async () => (await a.action("read")).body;
  return { h, a, propose, add, reviewer, cards, read };
}

test("pair propose records one file per card and refuses an ID the session has", async (t) => {
  const { h, a, propose, add, cards } = await proposing(t);
  const added = await add();
  assert.deepEqual(
    { ...added, recordedAt: undefined, updatedAt: undefined },
    {
      ...card,
      source: {},
      recordedAt: undefined,
      updatedAt: undefined,
      plan: null,
      started: null,
      declined: null,
      withdrawn: null,
      done: null,
    },
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(a.directory, "proposals", "churn-export.json"),
        "utf8",
      ),
    ),
    added,
  );
  // Any agent may record a card, such as one the holder briefed.
  const briefed = (await h.inbox()).agent;
  const other = await propose(
    { ...card, id: "board-qa", title: "Board Q&A prep", page: "1/overview" },
    briefed,
  );
  assert.equal(other.code, 200, other.body.error);
  // A card from a page keeps the page's title, which the card shows.
  assert.deepEqual(other.body.proposal.source, {
    page: { round: "1", id: "overview", title: "Overview" },
  });
  assert.equal(other.body.next, undefined);
  const again = await propose({ ...card, title: "Another title" });
  assert.equal(again.code, 409);
  assert.match(again.body.error, /already has proposal churn-export.*--revise/);
  assert.deepEqual(
    (await cards()).map(({ id, title }) => [id, title]),
    [
      ["churn-export", card.title],
      ["board-qa", "Board Q&A prep"],
    ],
  );
  const revised = await propose({
    id: "churn-export",
    revise: true,
    title: "Refresh the export",
  });
  assert.equal(revised.code, 200, revised.body.error);
  assert.equal(revised.body.proposal.title, "Refresh the export");
  assert.equal(revised.body.proposal.delivers, card.delivers);
  assert.equal(
    (await propose({ ...card, id: "Churn Export" })).code,
    400,
    "an ID that is not a slug",
  );
  assert.equal((await propose({ ...card, id: "x", page: "1/none" })).code, 400);
  // Every pair tab's bell announces each card.
  const listed = await a.request("/api/sessions");
  assert.deepEqual(
    listed.body.sessions[0].events
      .filter((event) => event.kind === "proposal")
      .map(({ proposal, page }) => [proposal, page]),
    [
      ["churn-export", "work"],
      ["board-qa", "work"],
    ],
  );
});

test("Start wakes the holder with the reviewer's message, and the round still waits for the reviewer", async (t) => {
  const { a, propose, add, reviewer, cards, read } = await proposing(t);
  await add();
  const message = "Keep the old column names.\nAsk before dropping any.";
  const started = await reviewer("churn-export", "start", {
    where: "here",
    message: `  ${message} `,
  });
  assert.equal(started.code, 200, started.body.error);
  const [entry] = started.body.proposals;
  assert.deepEqual(
    { ...entry.started, at: undefined },
    { at: undefined, round: "1", where: "here", by: "reviewer", message },
  );
  assert.equal(
    await waitUntil(() => a.inbox.wakes.length === 1),
    true,
    "one wake",
  );
  assert.equal(
    a.inbox.wakes[0].message.message.content,
    `pair: the reviewer started proposal churn-export, "${card.title}", here in session ${a.directory}. Run first: pair read --session-dir ${a.directory}. It prints the start and the next step.\n\nThe reviewer's message with Start, which pair read prints too:\n${message}`,
  );
  // Only the reviewer's feedback answers round 1, so it still waits for
  // them.
  const waits = async () => (await a.status()).body.needsYou;
  assert.equal(await waits(), true);

  const second = await reviewer("churn-export", "start", { where: "here" });
  assert.equal(second.code, 409);
  assert.equal(second.body.error, "Proposal churn-export was already started");
  const revise = await propose({
    id: "churn-export",
    revise: true,
    title: "Changed",
  });
  assert.equal(revise.code, 409);
  assert.match(revise.body.error, /was started, which approved what it said/);
  assert.equal((await reviewer("churn-export", "decline")).code, 409);
  await sleep(50);
  assert.equal(a.inbox.wakes.length, 1);

  const answer = await read();
  assert.equal(answer.moment, "read-start-here");
  assert.equal(answer.event.payload.proposal, "churn-export");
  assert.equal(answer.event.payload.message, message);
  assert.equal(answer.proposal.title, card.title);
  assert.equal((await cards())[0].started.where, "here");
  // Reading the Start leaves round 1 waiting, so the next step builds the
  // work now and publishes it in the next round, not in round 1.
  assert.equal(await waits(), true);
  assert.match(
    answer.next,
    /^Round 1 is published and waits for the reviewer\. .*build proposal churn-export, .*Publish the work's pages in the next round, which begins when the reviewer sends feedback\./,
  );
});

test("Decline and Restore move a card, and pair read prints a decline once", async (t) => {
  const { a, add, reviewer, cards, read } = await proposing(t);
  await add();
  await add({ id: "board-qa", title: "Board Q&A prep" });
  const declined = await reviewer("churn-export", "decline");
  assert.equal(declined.code, 200, declined.body.error);
  assert.ok(declined.body.proposals[0].declined.at);
  assert.equal((await reviewer("churn-export", "decline")).code, 200);
  const start = await reviewer("churn-export", "start", { where: "here" });
  assert.equal(start.code, 409);
  // A decline sends the agent nothing until it runs pair read, which
  // prints it once.
  await sleep(50);
  assert.equal(a.inbox.wakes.length, 0);
  assert.deepEqual(
    (await read()).declined.map(({ id }) => id),
    ["churn-export"],
  );
  assert.deepEqual((await read()).declined, []);

  const restored = await reviewer("churn-export", "restore");
  assert.equal(restored.code, 200, restored.body.error);
  assert.equal(restored.body.proposals[0].declined, null);
  assert.equal((await reviewer("board-qa", "decline")).code, 200);
  assert.equal((await reviewer("churn-export", "decline")).code, 200);
  assert.deepEqual((await read()).declined.map(({ id }) => id).sort(), [
    "board-qa",
    "churn-export",
  ]);
  assert.deepEqual(
    (await cards()).map((item) => Boolean(item.declined?.reported)),
    [true, true],
  );
});

// The agent starts a card when the reviewer asks for the work in their own
// words, and the start then runs as a Start does: the holder reads it with
// pair read, and the round still waits for the reviewer.
test("pair propose --start starts a card on the reviewer's words, and pair read prints the start", async (t) => {
  const { h, a, propose, add, cards, read } = await proposing(t);
  await add();
  await add({ id: "board-qa", title: "Board Q&A prep" });
  const thread = await a.request(`${a.base}/api/threads`, {
    id: "go",
    proposal: "churn-export",
    text: "Go ahead and refresh the export.",
  });
  assert.equal(thread.code, 201, thread.body.error);
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 1), true);
  const unquoted = await propose({ id: "churn-export", start: "here" });
  assert.equal(unquoted.code, 400);
  assert.equal(
    unquoted.body.error,
    "--start takes --quote with the reviewer's words",
  );
  const loose = await propose({ id: "churn-export", quote: "Go ahead." });
  assert.equal(loose.code, 400);
  assert.equal(loose.body.error, "--quote goes with --start.");
  assert.equal((await cards())[0].started, null);

  const started = await propose({
    id: "churn-export",
    start: "here",
    quote: "Go ahead and refresh the export.",
    thread: "go",
  });
  assert.equal(started.code, 200, started.body.error);
  assert.deepEqual(
    { ...started.body.proposal.started, at: undefined },
    {
      at: undefined,
      round: "1",
      where: "here",
      by: "words",
      quote: "Go ahead and refresh the export.",
      thread: "go",
    },
  );
  // The holder ran the command, and its next step reads the start, so the
  // hub sends it no wake.
  assert.equal(
    started.body.next,
    `Run: pair read --session-dir ${a.directory}`,
  );
  const answer = await read();
  assert.equal(answer.moment, "read-start-here");
  assert.equal(answer.event.payload.quote, "Go ahead and refresh the export.");
  assert.equal(answer.event.payload.thread, "go");
  assert.equal((await a.status()).body.needsYou, true);
  await sleep(50);
  assert.equal(a.inbox.wakes.length, 1);
  assert.equal(
    (await propose({ id: "churn-export", start: "here", quote: "Again." }))
      .code,
    409,
  );

  // Another agent's start wakes the holder, as the reviewer's Start does.
  const briefed = (await h.inbox()).agent;
  const apart = await propose(
    {
      id: "board-qa",
      start: "sub-session",
      quote: "Do the Q&A prep apart.",
      page: "1/overview",
    },
    briefed,
  );
  assert.equal(apart.code, 200, apart.body.error);
  assert.deepEqual(apart.body.proposal.started.page, {
    round: "1",
    id: "overview",
    title: "Overview",
  });
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 2), true);
  assert.equal(
    a.inbox.wakes[1].message.message.content,
    `pair: an agent started proposal board-qa, "Board Q&A prep", in a sub-session of session ${a.directory}, on the reviewer's words. Run first: pair read --session-dir ${a.directory}. It prints the start and the next step.\n\nThe reviewer's words, which pair read prints too:\nDo the Q&A prep apart.`,
  );
  const sub = await read();
  assert.equal(sub.moment, "read-start-sub-session");
  assert.equal(
    sub.next,
    `Run pair start --from ${a.directory} --proposal board-qa, then follow what it prints.`,
  );
  // Work with a new agent saves no start for pair read, so the holder's
  // next step is to open that agent.
  await add({ id: "deck", title: "Build the deck" });
  const agent = await propose({
    id: "deck",
    start: "new-agent",
    quote: "Have another agent build the deck.",
  });
  assert.equal(agent.code, 200, agent.body.error);
  assert.match(
    agent.body.next,
    new RegExp(
      `^Open a new agent session whose first command is: pair start --from ${literal(a.directory)} --proposal deck\\. `,
    ),
  );
  assert.equal((await read()).event, null);
});

// The agent clears a card nobody started with --withdraw and its reason.
// The card is in Done as the declined ones are, and the reviewer's Restore
// puts it back.
test("--withdraw moves a card to Done with its reason, and Restore brings it back", async (t) => {
  const { propose, add, reviewer, cards, read } = await proposing(t);
  await add();
  await add({ id: "board-qa", title: "Board Q&A prep" });
  const bare = await propose({ id: "churn-export", withdraw: true });
  assert.equal(bare.code, 400);
  const reason = "The September schema change was reverted.";
  const withdrawn = await propose({
    id: "churn-export",
    withdraw: true,
    reason,
  });
  assert.equal(withdrawn.code, 200, withdrawn.body.error);
  assert.deepEqual(
    { ...withdrawn.body.proposal.withdrawn, at: undefined },
    { at: undefined, reason },
  );
  assert.equal(withdrawn.body.proposal.declined, null);
  // A withdrawn card takes no Start and no plan until it is restored, and
  // pair read does not report it as declined.
  assert.equal(
    (await reviewer("churn-export", "start", { where: "here" })).code,
    409,
  );
  assert.equal(
    (await propose({ id: "churn-export", start: "here", quote: "Do it." }))
      .code,
    409,
  );
  assert.deepEqual((await read()).declined, []);
  const restored = await reviewer("churn-export", "restore");
  assert.equal(restored.code, 200, restored.body.error);
  assert.equal(restored.body.proposals[0].withdrawn, null);
  assert.equal(
    (await reviewer("churn-export", "start", { where: "here" })).code,
    200,
  );
  // A started card takes no --withdraw.
  const late = await propose({ id: "churn-export", withdraw: true, reason });
  assert.equal(late.code, 409);
  assert.deepEqual(
    (await cards()).map(({ id, withdrawn: gone }) => [id, gone]),
    [
      ["churn-export", null],
      ["board-qa", null],
    ],
  );
});

// Work started here is done when the agent says so. Any other card is done
// with --where, when its work got done somewhere else, and --reopen undoes
// the agent's own --done.
test("--done marks work started here done, --where marks any card done, and --reopen undoes either", async (t) => {
  const { propose, add, reviewer, cards } = await proposing(t);
  await add();
  await add({ id: "board-qa", title: "Board Q&A prep" });
  const early = await propose({ id: "churn-export", done: true });
  assert.equal(early.code, 409);
  assert.equal(
    early.body.error,
    'Proposal churn-export has not been started. When its work got done somewhere else, run --done with --where, such as --where "in #86".',
  );
  const elsewhere = await propose({
    id: "churn-export",
    done: true,
    where: "in #86",
  });
  assert.equal(elsewhere.code, 200, elsewhere.body.error);
  assert.deepEqual(
    { ...elsewhere.body.proposal.done, at: undefined },
    { at: undefined, by: "agent", round: "1", where: "in #86" },
  );
  assert.equal(elsewhere.body.proposal.started, null);
  // A done card takes no Start, and --reopen puts it back in Proposed.
  assert.equal(
    (await reviewer("churn-export", "start", { where: "here" })).code,
    409,
  );
  const back = await propose({ id: "churn-export", reopen: true });
  assert.equal(back.code, 200, back.body.error);
  assert.equal(back.body.proposal.done, null);

  assert.equal(
    (await reviewer("board-qa", "start", { where: "sub-session" })).code,
    200,
  );
  // A card whose work runs in its own session finishes only when that
  // session closes, so it keeps its link to the session.
  assert.equal((await propose({ id: "board-qa", done: true })).code, 409);
  const linked = await propose({ id: "board-qa", done: true, where: "in #87" });
  assert.equal(linked.code, 409);
  assert.equal(
    linked.body.error,
    "Proposal board-qa runs in a sub-session, so closing that session marks it done.",
  );
  assert.equal(
    (await reviewer("churn-export", "start", { where: "here" })).code,
    200,
  );
  assert.equal((await propose({ id: "churn-export", reopen: true })).code, 409);
  const done = await propose({ id: "churn-export", done: true });
  assert.equal(done.code, 200, done.body.error);
  assert.deepEqual(
    { ...done.body.proposal.done, at: undefined },
    { at: undefined, by: "agent", round: "1" },
  );
  assert.equal((await propose({ id: "churn-export", done: true })).code, 409);
  const reopened = await propose({ id: "churn-export", reopen: true });
  assert.equal(reopened.code, 200, reopened.body.error);
  assert.deepEqual(
    (await cards()).map((card) => [card.id, card.done?.where ?? null]),
    [
      ["churn-export", null],
      ["board-qa", null],
    ],
  );
});

test("a thread on a card wakes the holder with the card it is on", async (t) => {
  const { a, add } = await proposing(t);
  await add();
  const started = await a.request(`${a.base}/api/threads`, {
    id: "why",
    proposal: "churn-export",
    text: "Why September?",
  });
  assert.equal(started.code, 201, started.body.error);
  assert.deepEqual(
    {
      proposal: started.body.thread.proposal,
      page: started.body.thread.page,
      round: started.body.thread.round,
    },
    { proposal: "churn-export", page: card.title, round: undefined },
  );
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 1), true);
  assert.match(
    a.inbox.wakes[0].message.message.content,
    /^pair: a thread on proposal churn-export, "Refresh the churn data export", session /,
  );
  const missing = await a.request(`${a.base}/api/threads`, {
    id: "lost",
    proposal: "nothing",
    text: "Hello?",
  });
  assert.equal(missing.code, 404);
});
