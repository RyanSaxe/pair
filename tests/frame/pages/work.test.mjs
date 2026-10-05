import assert from "node:assert/strict";
import { test } from "node:test";
import { openingTab, workGroups } from "#frame/pages/work.mjs";

const card = (id, facts = {}) => ({
  id,
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

// The tab of each card follows from its facts, the linked sessions' rounds
// and the bell's unread replies, and Work opens on the first tab with a
// card.
test("Work counts each tab's cards and opens on the first tab with one", () => {
  const cards = [
    card("proposed"),
    card("running", { started: here }),
    card("done", { started: here, done: { at: here.at, by: "agent" } }),
    card("declined", { declined: { at: here.at } }),
    card("replied"),
  ];
  const working = workGroups(cards, { unread: new Set() });
  assert.deepEqual(counts(working), {
    needs: 0,
    running: 1,
    proposed: 2,
    done: 2,
  });
  assert.equal(openingTab(working), "running");

  // A card with an unread reply needs the reviewer whatever its state.
  const replied = workGroups(cards, { unread: new Set(["replied", "done"]) });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(replied).map(([id, list]) => [id, list.map((c) => c.id)]),
    ),
    {
      needs: ["done", "replied"],
      running: ["running"],
      proposed: ["proposed"],
      done: ["declined"],
    },
  );
  assert.equal(openingTab(replied), "needs");

  // Work in a linked session waits for the reviewer while that session's
  // round does.
  const linked = (id) => ({ ...here, where: "new-agent", session: { id } });
  const sessions = { waiting: { needsYou: true }, busy: { needsYou: false } };
  const elsewhere = workGroups(
    [
      card("waits", { started: linked("waiting") }),
      card("works", { started: linked("busy") }),
      card("opening", { started: { ...here, where: "sub-session" } }),
    ],
    { linked: (id) => sessions[id] },
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
