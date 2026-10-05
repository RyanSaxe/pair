import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import {
  hub,
  literal,
  planData,
  sleep,
  waitUntil,
} from "../../support/hub.mjs";

const card = (id, title) => ({
  id,
  title,
  delivers: `${title}, delivered.`,
  recommend: "new-agent",
});
// A parent session with round 1 waiting for the reviewer and two cards.
// reviewer posts a card's route from the browser, and link registers a new
// session as pair start --from does, from another agent's inbox.
async function linking(t) {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  for (const [id, title] of [
    ["deck", "Build the deck"],
    ["notes", "Write the speaker notes"],
  ])
    assert.equal((await a.action("propose", card(id, title))).code, 200);
  const reviewer = (id, action, body = {}) =>
    a.request(`${a.base}/api/proposals/${id}/${action}`, body);
  const cardOf = async (id) =>
    (await a.status()).body.proposals.find((item) => item.id === id);
  async function link(proposal) {
    const box = await h.inbox();
    const directory = path.join(h.config.sessions, crypto.randomUUID());
    const registered = await h.register(directory, box.target, {
      start: true,
      from: a.directory,
      proposal,
    });
    assert.equal(registered.code, 200, registered.body.error);
    return { ...registered.body, base: `/s/${registered.body.sessionId}` };
  }
  return { h, a, reviewer, cardOf, link };
}

test("Open a new agent session starts the card with a new agent and asks the holder in a thread", async (t) => {
  const { a, reviewer, cardOf, link } = await linking(t);
  const opened = await reviewer("deck", "open-agent", {
    message: "Use the board template.",
  });
  assert.equal(opened.code, 200, opened.body.error);
  const { started } = await cardOf("deck");
  assert.deepEqual(
    { ...started, at: undefined },
    {
      at: undefined,
      round: "1",
      where: "new-agent",
      by: "reviewer",
      message: "Use the board template.",
    },
  );
  // The thread is on the card, and the holder is woken as for any thread.
  const { thread } = opened.body;
  assert.equal(thread.kind, "open-agent");
  assert.equal(thread.proposal, "deck");
  assert.equal(thread.messages[0].text, "Use the board template.");
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 1), true);
  assert.match(
    a.inbox.wakes[0].message.message.content,
    new RegExp(`--thread ${thread.id}`),
  );
  // Opening it neither answers the round nor saves a Start for pair read.
  const status = (await a.status()).body;
  assert.equal(status.needsYou, true);
  assert.equal((await a.action("read")).body.event, null);
  const read = await a.action("reply", { note: thread.id });
  assert.equal(read.body.moment, "read-open-agent");
  assert.match(
    read.body.next,
    new RegExp(`pair start --from ${literal(a.directory)} --proposal deck`),
  );
  // Once the new agent's session links, the thread is an ordinary one.
  await link("deck");
  assert.equal(
    (await a.action("reply", { note: thread.id })).body.moment,
    "read-thread",
  );
  // A card started here or already linked takes no new agent.
  assert.equal((await reviewer("deck", "open-agent")).code, 409);
  assert.equal(
    (await reviewer("notes", "start", { where: "here" })).code,
    200,
    "start notes here",
  );
  assert.equal((await reviewer("notes", "open-agent")).code, 409);
});

test("a Start in a sub-session wakes the holder, leaves the round waiting, and pair read names pair start --from", async (t) => {
  const { a, reviewer } = await linking(t);
  assert.equal(
    (await reviewer("deck", "start", { where: "sub-session" })).code,
    200,
  );
  assert.equal(await waitUntil(() => a.inbox.wakes.length === 1), true);
  assert.match(
    a.inbox.wakes[0].message.message.content,
    /approved proposal deck, "Build the deck", to run in a sub-session of session /,
  );
  const before = (await a.status()).body;
  assert.equal(before.needsYou, true);
  const read = (await a.action("read")).body;
  assert.equal(read.moment, "read-start-sub-session");
  assert.equal(read.proposal.id, "deck");
  assert.equal(
    read.next,
    `Run pair start --from ${a.directory} --proposal deck, then follow what it prints.`,
  );
  // The round still waits for the reviewer after the agent read the Start.
  const status = (await a.status()).body;
  assert.equal(status.needsYou, true);
  assert.equal(status.stage, before.stage);
});

test("closing a linked session marks its card done once with no wake, and a closed parent stays listed while one is open", async (t) => {
  const { a, reviewer, cardOf, link } = await linking(t);
  for (const id of ["deck", "notes"])
    assert.equal(
      (await reviewer(id, "start", { where: "new-agent" })).code,
      200,
    );
  const deck = await link("deck");
  const notes = await link("notes");
  const listing = async () =>
    Object.fromEntries(
      (await a.request("/api/sessions")).body.sessions.map(
        ({ id, parentId, proposal, closed }) => [
          id,
          { parentId, proposal, closed },
        ],
      ),
    );
  assert.deepEqual(await listing(), {
    [a.id]: { parentId: null, proposal: null, closed: false },
    [deck.sessionId]: { parentId: a.id, proposal: "deck", closed: false },
    [notes.sessionId]: { parentId: a.id, proposal: "notes", closed: false },
  });
  const close = (session) => a.request(`${session.base}/api/dismiss`, {});
  const wakes = a.inbox.wakes.length;
  assert.equal((await close(deck)).code, 200);
  assert.equal((await cardOf("deck")).done.by, "close");
  // --reopen undoes only the agent's own --done.
  assert.equal(
    (await a.action("propose", { id: "deck", reopen: true })).code,
    409,
  );
  await sleep(100);
  assert.equal(a.inbox.wakes.length, wakes, "no wake for a close");
  // The parent's next pair read reports the close, and the one after it
  // does not.
  const read = (await a.action("read")).body;
  assert.deepEqual(
    read.closed.map(({ id }) => id),
    ["deck"],
  );
  assert.deepEqual((await a.action("read")).body.closed, []);
  // Closing the parent leaves it listed, closed, over its open sub-session,
  // and both leave the list once that one closes.
  assert.equal((await close(a)).code, 200);
  assert.deepEqual(
    Object.keys(await listing()).sort(),
    [a.id, notes.sessionId].sort(),
  );
  assert.equal((await listing())[a.id].closed, true);
  assert.equal((await close(notes)).code, 200);
  assert.equal((await cardOf("notes")).done.by, "close");
  assert.deepEqual(await listing(), {});
});

// The agent of a linked session writes the status of the work it runs
// with its own session's directory, and the hub puts it on the card in
// the parent, which the parent's directory also reaches.
test("a status from a linked session goes to the parent's card", async (t) => {
  const { h, a, reviewer, cardOf } = await linking(t);
  assert.equal(
    (await reviewer("deck", "start", { where: "sub-session" })).code,
    200,
  );
  const child = await h.session({
    start: true,
    from: a.directory,
    proposal: "deck",
  });
  const written = await child.action("propose", {
    id: "deck",
    statusDone: ["Outline"],
    statusLeft: ["Slides"],
  });
  assert.equal(written.code, 200, written.body.error);
  assert.deepEqual(written.body.parent, { id: a.id, title: "Example work" });
  assert.deepEqual(
    { ...(await cardOf("deck")).status, at: undefined },
    { at: undefined, done: ["Outline"], left: ["Slides"] },
  );
  const fromParent = await a.action("propose", {
    id: "deck",
    statusDone: ["Outline", "Slides"],
  });
  assert.equal(fromParent.code, 200, fromParent.body.error);
  assert.equal(fromParent.body.parent, undefined);
  assert.deepEqual((await cardOf("deck")).status.done, ["Outline", "Slides"]);
  // The linked session runs only deck, so it reaches no other card.
  const other = await child.action("propose", {
    id: "notes",
    statusLeft: ["Draft"],
  });
  assert.equal(other.code, 404);
});
