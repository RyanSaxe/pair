import assert from "node:assert/strict";
import test from "node:test";
import {
  byStart,
  groupSessions,
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

test("the sessions badge counts the other sessions with something unseen, and otherwise the other live sessions in grey", () => {
  const none = () => 0;
  const newIn = (ids) => (item) => (ids.includes(item.id) ? 2 : 0);
  // A session whose round 1 waits for you, as the hub lists it.
  const waiting = (id) =>
    entry(id, {
      needsYou: true,
      events: [{ id: `w${id}`, kind: "waiting", round: "1" }],
    });
  const cases = [
    // [sessions, unopened, the bell's removed events, count, tone]
    [[entry("1")], none, [], 0, ""],
    [[entry("1"), entry("2"), entry("3", { paused: true })], none, [], 2, ""],
    [[entry("1"), waiting("2"), entry("3")], none, [], 1, "need"],
    [[entry("1"), entry("2", { wakeFailed: true })], none, [], 1, "need"],
    [[entry("1"), entry("2"), entry("3")], newIn(["2"]), [], 1, "news"],
    // A waiting round turns the count of both kinds orange.
    [
      [entry("1"), waiting("2"), entry("3"), entry("4")],
      newIn(["3"]),
      [],
      2,
      "need",
    ],
    // A waiting round you have seen no longer counts, and new pages still
    // do.
    [[entry("1"), waiting("2"), entry("3")], none, ["w2"], 2, ""],
    [[entry("1"), waiting("2"), entry("3")], newIn(["3"]), ["w2"], 1, "news"],
    // A seen round 1 does not hide round 2 when it waits.
    [
      [
        entry("1"),
        entry("2", {
          round: "2",
          needsYou: true,
          events: [
            { id: "w2", kind: "waiting", round: "1" },
            { id: "w2b", kind: "waiting", round: "2" },
          ],
        }),
      ],
      none,
      ["w2"],
      1,
      "need",
    ],
    // This tab's own waiting round and new pages never count.
    [[waiting("1"), entry("2")], newIn(["1"]), [], 1, ""],
  ];
  for (const [list, unopened, cleared, count, tone] of cases)
    assert.deepEqual(sessionsBadge(list, "1", unopened, new Set(cleared)), {
      count,
      tone,
    });
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

// Sub-sessions follow the session they came from, in the order they
// started, and a closed parent the hub still lists heads them.
test("Sessions lists each sub-session after its parent, one step in, under a closed parent's heading", () => {
  const rows = (list) =>
    groupSessions(list).map(({ entry, depth }) => [
      entry.id,
      depth,
      Boolean(entry.closed),
    ]);
  assert.deepEqual(
    rows([
      entry("4", { parentId: "1" }),
      entry("3"),
      entry("2", { parentId: "1" }),
      entry("5", { parentId: "2" }),
      entry("1", { closed: true }),
    ]),
    [
      ["1", 0, true],
      ["2", 1, false],
      ["5", 2, false],
      ["4", 1, false],
      ["3", 0, false],
    ],
  );
  // A sub-session whose parent is not listed stands at the top.
  assert.deepEqual(rows([entry("2", { parentId: "9" }), entry("1")]), [
    ["1", 0, false],
    ["2", 0, false],
  ]);
});
