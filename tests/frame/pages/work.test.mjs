import assert from "node:assert/strict";
import { test } from "node:test";
import { openingTab, planLine, workGroups } from "#frame/pages/work.mjs";

const card = (id, facts = {}) => ({
  id,
  plan: null,
  started: null,
  declined: null,
  done: null,
  ...facts,
});
const here = { at: "2026-10-04T00:00:00.000Z", where: "here" };
const counts = (groups) =>
  Object.fromEntries(
    Object.entries(groups).map(([id, list]) => [id, list.length]),
  );

// The tab of each card follows from its facts, the session's round and the
// bell's unread replies, and Work opens on the first tab with a card.
test("Work counts each tab's cards and opens on the first tab with one", () => {
  const cards = [
    card("proposed"),
    card("running", { started: here }),
    card("done", { started: here, done: { at: here.at, by: "agent" } }),
    card("declined", { declined: { at: here.at } }),
    card("replied"),
  ];
  const working = workGroups(cards, { needsYou: false, unread: new Set() });
  assert.deepEqual(counts(working), {
    needs: 0,
    running: 1,
    proposed: 2,
    done: 2,
  });
  assert.equal(openingTab(working), "running");

  // Work started here waits for the reviewer while the session's round
  // does, and a card with an unread reply needs them whatever its state.
  const waiting = workGroups(cards, {
    needsYou: true,
    unread: new Set(["replied", "done"]),
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(waiting).map(([id, list]) => [id, list.map((c) => c.id)]),
    ),
    {
      needs: ["running", "done", "replied"],
      running: [],
      proposed: ["proposed"],
      done: ["declined"],
    },
  );
  assert.equal(openingTab(waiting), "needs");

  // Work in a linked session waits for the reviewer while that session's
  // round does, whatever this session's round does.
  const linked = (id) => ({ ...here, where: "new-agent", session: { id } });
  const sessions = { waiting: { needsYou: true }, busy: { needsYou: false } };
  const elsewhere = workGroups(
    [
      card("waits", { started: linked("waiting") }),
      card("works", { started: linked("busy") }),
      card("opening", { started: { ...here, where: "sub-session" } }),
    ],
    { needsYou: true, linked: (id) => sessions[id] },
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(elsewhere).map(([id, list]) => [
        id,
        list.map((c) => c.id),
      ]),
    ),
    { needs: ["waits"], running: ["works", "opening"], proposed: [], done: [] },
  );

  const proposedOnly = workGroups([card("a")], {});
  assert.equal(openingTab(proposedOnly), "proposed");
  assert.equal(openingTab(workGroups([], {})), "needs");
});

// A card's plan line names the round after which the plan last changed and
// the rounds it came from, as pair plan's --rounds gave them.
test("a card's plan line reads one round or a range", () => {
  const plan = (rounds) => ({ at: here.at, round: "6", rounds, pages: [] });
  assert.equal(planLine(null), "No plan yet.");
  assert.equal(
    planLine(plan("3-6")),
    "Plan updated after round 6, from rounds 3 to 6.",
  );
  assert.equal(
    planLine(plan("4")),
    "Plan updated after round 6, from round 4.",
  );
});
