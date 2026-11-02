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
const at = "2026-10-04T00:00:00.000Z";
const here = { at, where: "here" };
const ids = (groups) =>
  Object.fromEntries(
    Object.entries(groups).map(([id, list]) => [id, list.map((c) => c.id)]),
  );

test("a card goes to the tab of its own state", () => {
  assert.deepEqual(
    ids(
      workGroups([
        card("proposed"),
        card("running", { started: here }),
        card("elsewhere", {
          started: { at, where: "new-agent", session: { id: "linked" } },
        }),
        card("opening", { started: { at, where: "sub-session" } }),
        card("done", { started: here, done: { at, by: "agent" } }),
        card("declined", { declined: { at } }),
        card("withdrawn", { withdrawn: { at, reason: "Not needed." } }),
      ]),
    ),
    {
      running: ["running", "elsewhere", "opening"],
      proposed: ["proposed"],
      done: ["done", "declined", "withdrawn"],
    },
  );
});

test("Work opens on Proposed while a proposal waits for Start, and otherwise on the first tab with a card", () => {
  const running = card("running", { started: here });
  const done = card("done", { done: { at, by: "agent" } });
  const opens = (...cards) => openingTab(workGroups(cards));
  assert.equal(opens(running, card("proposed"), done), "proposed");
  assert.equal(opens(running, done), "running");
  assert.equal(opens(done), "done");
  assert.equal(opens(), "running");
});
