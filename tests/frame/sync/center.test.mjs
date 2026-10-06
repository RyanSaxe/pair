import assert from "node:assert/strict";
import test from "node:test";
import {
  bellLines,
  sessionWords,
  settleCleared,
} from "../../../src/frame/sync/center.mjs";

const event = (id, kind, at) => ({ id, kind, at });

test("the bell lists every session's starts, waiting rounds and replies, newest first, without page events, removed lines or this tab's own start and round", () => {
  const sessions = [
    {
      id: "a",
      round: "1",
      needsYou: true,
      events: [
        event("s1", "session", "2026-09-28T09:00:00Z"),
        event("r1", "reply", "2026-09-28T10:00:00Z"),
        event("p1", "page", "2026-09-28T10:05:00Z"),
        { ...event("a1", "waiting", "2026-09-28T10:06:00Z"), round: "1" },
      ],
    },
    {
      id: "b",
      round: "2",
      needsYou: true,
      events: [
        event("s2", "session", "2026-09-28T09:30:00Z"),
        event("r2", "reply", "2026-09-28T10:10:00Z"),
        // A round sent before the one that waits now has no line.
        { ...event("b1", "waiting", "2026-09-28T10:11:00Z"), round: "1" },
        { ...event("b2", "waiting", "2026-09-28T10:12:00Z"), round: "2" },
      ],
    },
  ];
  const lines = (list, cleared = new Set()) =>
    bellLines(list, cleared, "a").map(({ id }) => id);
  assert.deepEqual(lines(sessions), ["b2", "r2", "r1", "s2"]);
  assert.deepEqual(lines(sessions, new Set(["r2"])), ["b2", "r1", "s2"]);
  // Sending the round that waits removes its line.
  const sent = [sessions[0], { ...sessions[1], needsYou: false }];
  assert.deepEqual(lines(sent), ["r2", "r1", "s2"]);
});

test("a browser with no record starts with an empty bell, and later forgets IDs the hub dropped", () => {
  assert.deepEqual([...settleCleared(["r1", "r2"], null)], ["r1", "r2"]);
  assert.deepEqual([...settleCleared(["r2"], new Set(["r1", "r2"]))], ["r2"]);
});

// A sub-session's line names its parent, which the hub lists, closed or
// not, and a closed session adds no line.
test("a sub-session's bell line names its parent, and a closed parent adds no line", () => {
  const parent = {
    id: "a",
    title: "Q3 pricing deck",
    closed: true,
    events: [event("r1", "reply", "2026-09-28T10:00:00Z")],
  };
  const child = {
    id: "b",
    title: "Build the deck",
    parentId: "a",
    events: [event("r2", "reply", "2026-09-28T10:10:00Z")],
  };
  assert.deepEqual(
    bellLines([parent, child], new Set(), "x").map(({ id }) => id),
    ["r2"],
  );
  assert.equal(
    sessionWords(child, [parent, child]),
    "Sub-session of Q3 pricing deck · Build the deck",
  );
  assert.equal(sessionWords(parent, [parent, child]), "Q3 pricing deck");
});
