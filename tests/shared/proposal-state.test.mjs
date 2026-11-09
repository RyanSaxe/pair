import assert from "node:assert/strict";
import test from "node:test";
import { allows, proposalState } from "../../src/shared/proposal-state.mjs";

const actions = [
  "revise",
  "withdraw",
  "decline",
  "start",
  "openAgent",
  "join",
  "joinInto",
  "restore",
  "done",
  "doneWhere",
  "reopen",
  "status",
  "link",
  "close",
  "reopenSession",
];

// tests/hub/session/proposals.test.mjs, tests/hub/session/links.test.mjs and
// tests/cli/start-from.test.mjs take a card through every other state and the
// actions it accepts and refuses. No hub test opens a new agent session again
// for a card whose new agent has not run pair start --from, or reports its
// status before then.
test("a card started with a new agent that no session links to yet is opening, and accepts openAgent, status and link", () => {
  const card = {
    id: "card",
    started: { at: "2026-11-08T12:00:00.000Z", where: "new-agent" },
    declined: null,
    withdrawn: null,
    done: null,
  };
  assert.equal(proposalState(card), "opening");
  assert.deepEqual(
    actions.filter((action) => allows(card, action)),
    ["openAgent", "status", "link"],
  );
});
