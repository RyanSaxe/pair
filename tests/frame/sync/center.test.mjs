import assert from "node:assert/strict";
import test from "node:test";
import { bellLines, settleCleared } from "../../../src/frame/sync/center.mjs";

const event = (id, kind, at) => ({ id, kind, at });

test("the bell lists every session's waiting rounds and replies, newest first, without starts, page events, removed lines or this tab's own round", () => {
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
        // Session b's current round is 2, so bellLines gives its round 1
        // waiting event no line.
        { ...event("b1", "waiting", "2026-09-28T10:11:00Z"), round: "1" },
        { ...event("b2", "waiting", "2026-09-28T10:12:00Z"), round: "2" },
      ],
    },
  ];
  const lines = (list, cleared = new Set()) =>
    bellLines(list, cleared, "a").map(({ id }) => id);
  assert.deepEqual(lines(sessions), ["b2", "r2", "r1"]);
  assert.deepEqual(lines(sessions, new Set(["r2"])), ["b2", "r1"]);
  // After the reviewer sends round 2, the hub lists needsYou false, and
  // bellLines drops the waiting line.
  const sent = [sessions[0], { ...sessions[1], needsYou: false }];
  assert.deepEqual(lines(sent), ["r2", "r1"]);
});

test("the bell forgets removed IDs the hub dropped", () => {
  assert.deepEqual([...settleCleared(["r2"], new Set(["r1", "r2"]))], ["r2"]);
});

test("a closed session adds no line", () => {
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
});
