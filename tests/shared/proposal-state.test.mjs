import assert from "node:assert/strict";
import test from "node:test";
import { allows, proposalState } from "../../src/shared/proposal-state.mjs";

const at = "2026-11-08T12:00:00.000Z";
const here = { at, where: "here" };
const subSession = { at, where: "sub-session" };
const linked = { ...subSession, session: { id: "child", dir: "/child" } };
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

// Each row is a card as the hub stores it after one path through Work and
// pair propose, the state proposalState names, and the actions that state
// accepts.
test("proposalState names a card's state from its fields, and each state accepts its own actions", () => {
  for (const [facts, state, accepted] of [
    [
      {},
      "proposed",
      [
        "revise",
        "withdraw",
        "decline",
        "start",
        "openAgent",
        "join",
        "joinInto",
        "doneWhere",
      ],
    ],
    [{ started: here }, "running", ["joinInto", "done", "doneWhere", "status"]],
    [{ started: subSession }, "opening", ["openAgent", "status", "link"]],
    [{ started: linked }, "linked", ["status", "close"]],
    [{ started: here, done: { at, by: "agent" } }, "done", ["reopen"]],
    [{ done: { at, by: "agent", where: "in #86" } }, "done", ["reopen"]],
    [{ done: { at, by: "agent", joined: "big" } }, "joined", ["reopen"]],
    [
      { started: linked, done: { at, by: "close" } },
      "closed",
      ["reopenSession"],
    ],
    [{ declined: { at } }, "declined", ["restore"]],
    [
      { withdrawn: { at, reason: "No longer needed" } },
      "withdrawn",
      ["restore"],
    ],
  ]) {
    const card = {
      id: "card",
      started: null,
      declined: null,
      withdrawn: null,
      done: null,
      ...facts,
    };
    assert.equal(proposalState(card), state);
    assert.deepEqual(
      actions.filter((action) => allows(card, action)),
      accepted,
      state,
    );
  }
});
