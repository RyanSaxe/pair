import assert from "node:assert/strict";
import test from "node:test";
import {
  bellLines,
  sessionWords,
  settleCleared,
  threadGroups,
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
        // Session b's current round is 2, so bellLines gives its round 1
        // waiting event no line.
        { ...event("b1", "waiting", "2026-09-28T10:11:00Z"), round: "1" },
        { ...event("b2", "waiting", "2026-09-28T10:12:00Z"), round: "2" },
      ],
    },
  ];
  const lines = (list, cleared = new Set()) =>
    bellLines(list, cleared, "a").map(({ id }) => id);
  assert.deepEqual(lines(sessions), ["b2", "r2", "r1", "s2"]);
  assert.deepEqual(lines(sessions, new Set(["r2"])), ["b2", "r1", "s2"]);
  // After the reviewer sends round 2, the hub lists needsYou false, and
  // bellLines drops the waiting line.
  const sent = [sessions[0], { ...sessions[1], needsYou: false }];
  assert.deepEqual(lines(sent), ["r2", "r1", "s2"]);
});

test("the bell forgets removed IDs the hub dropped", () => {
  assert.deepEqual([...settleCleared(["r2"], new Set(["r1", "r2"]))], ["r2"]);
});

// The hub still lists a closed session, so sessionWords can name a closed
// parent.
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

test("the Threads tab has a group per live session, this session first, with each group's waiting threads before its answered ones", () => {
  const waiting = (thread, waitingSince) => ({ thread, waitingSince });
  const answered = (thread, answeredAt) => ({ thread, answeredAt });
  const sessions = [
    {
      id: "other",
      threads: [
        answered("other-answered", "2026-09-28T09:45:00Z"),
        waiting("other-waiting", "2026-09-28T10:00:00Z"),
      ],
    },
    { id: "quiet", threads: [] },
    {
      id: "here",
      threads: [
        waiting("new", "2026-09-28T10:30:00Z"),
        answered("answered-old", "2026-09-28T09:00:00Z"),
        waiting("old", "2026-09-28T10:00:00Z"),
        answered("answered-new", "2026-09-28T09:30:00Z"),
      ],
    },
    {
      id: "closed",
      closed: true,
      threads: [waiting("gone", "2026-09-28T08:00:00Z")],
    },
  ];
  assert.deepEqual(
    threadGroups(sessions, "here").map(({ entry, lines }) => [
      entry.id,
      lines.map(({ thread }) => thread),
    ]),
    [
      ["here", ["old", "new", "answered-new", "answered-old"]],
      ["other", ["other-waiting", "other-answered"]],
    ],
  );
});
