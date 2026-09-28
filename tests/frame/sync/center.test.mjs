import assert from "node:assert/strict";
import test from "node:test";
import { bellLines, settleCleared } from "../../../src/frame/sync/center.mjs";

const event = (id, kind, at) => ({ id, kind, at });

test("the bell lists every session's replies and pull requests, newest first, without page events or removed lines", () => {
  const sessions = [
    {
      id: "a",
      events: [
        event("r1", "reply", "2026-09-28T10:00:00Z"),
        event("p1", "page", "2026-09-28T10:05:00Z"),
      ],
    },
    { id: "b", events: [event("w1", "side-work", "2026-09-28T10:10:00Z")] },
  ];
  assert.deepEqual(
    bellLines(sessions, new Set()).map(({ id, entry }) => [id, entry.id]),
    [
      ["w1", "b"],
      ["r1", "a"],
    ],
  );
  assert.deepEqual(
    bellLines(sessions, new Set(["w1"])).map(({ id }) => id),
    ["r1"],
  );
});

test("a browser with no record starts with an empty bell, and later forgets IDs the hub dropped", () => {
  assert.deepEqual([...settleCleared(["r1", "w1"], null)], ["r1", "w1"]);
  assert.deepEqual([...settleCleared(["r2"], new Set(["r1", "r2"]))], ["r2"]);
});
