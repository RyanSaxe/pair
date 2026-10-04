import assert from "node:assert/strict";
import test from "node:test";
import {
  byStart,
  nextWaiting,
  rowStatus,
  sessionsBadge,
} from "../../../src/frame/sync/sessions.mjs";

const entry = (id, fields = {}) => ({
  id,
  round: "1",
  startedAt: `2026-09-28T1${id}`,
  ...fields,
});

test("the sessions badge counts the other sessions that need you, and otherwise the other live sessions in grey", () => {
  const none = () => 0;
  const newIn = (ids) => (item) => (ids.includes(item.id) ? 2 : 0);
  const cases = [
    // [sessions, unopened, count, tone]
    [[entry("1")], none, 0, ""],
    [[entry("1"), entry("2"), entry("3", { paused: true })], none, 2, ""],
    [[entry("1"), entry("2", { needsYou: true }), entry("3")], none, 1, "need"],
    [[entry("1"), entry("2", { wakeFailed: true })], none, 1, "need"],
    [[entry("1"), entry("2"), entry("3")], newIn(["2"]), 1, "news"],
    // A waiting round turns the count of both kinds orange.
    [
      [entry("1"), entry("2", { needsYou: true }), entry("3"), entry("4")],
      newIn(["3"]),
      2,
      "need",
    ],
    // This tab's own waiting round and new pages never count.
    [[entry("1", { needsYou: true }), entry("2")], newIn(["1"]), 1, ""],
  ];
  for (const [list, unopened, count, tone] of cases)
    assert.deepEqual(sessionsBadge(list, "1", unopened), { count, tone });
});

test("sessions keep the order they started in, and w reaches the next waiting one after this tab, wrapping", () => {
  const order = byStart([
    entry("3", { needsYou: true }),
    entry("1", { needsYou: true }),
    entry("4"),
    entry("2"),
  ]);
  assert.deepEqual(
    order.map(({ id }) => id),
    ["1", "2", "3", "4"],
  );
  assert.equal(nextWaiting(order, "1").id, "3");
  assert.equal(nextWaiting(order, "3").id, "1");
  assert.equal(nextWaiting(order, "4").id, "1");
  assert.equal(nextWaiting([entry("1"), entry("2")], "1"), undefined);
  // This tab's own waiting round is never the next one.
  assert.equal(nextWaiting([entry("1", { needsYou: true })], "1"), undefined);
});

test("a row shows the first status that applies", () => {
  const cases = [
    [{ needsYou: true, wakeFailed: true }, 2, "Waiting"],
    [{ wakeFailed: true, paused: true }, 2, "Can't wake"],
    [{ stage: "working", paused: true }, 2, "2 new"],
    [{ paused: true, stage: "working" }, 0, "Paused"],
    [{ stage: "working" }, 0, "Working"],
    [{ stage: "updated", openRound: { ready: 1 } }, 0, "Working"],
    // The agent prepares the first round of a session with nothing published.
    [{ round: null, stage: "ready" }, 0, "Working"],
    [{ stage: "complete" }, 0, undefined],
  ];
  for (const [fields, unopened, text] of cases)
    assert.equal(rowStatus(entry("2", fields), unopened)?.text, text);
});
