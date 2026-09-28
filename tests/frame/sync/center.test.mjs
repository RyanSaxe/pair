import assert from "node:assert/strict";
import test from "node:test";
import { bellNumber } from "../../../src/frame/sync/center.mjs";

test("the bell counts waiting sessions and unseen events, red while one waits and blue when only events are new", () => {
  const events = ["a", "b", "c"].map((id) => ({ id }));
  const memory = (seen = [], cleared = []) => ({
    seen: new Set(seen),
    cleared: new Set(cleared),
  });
  const cases = [
    [0, [], memory(), { count: 0, tone: "" }],
    [1, [], memory(), { count: 1, tone: "need" }],
    [1, events.slice(0, 2), memory(), { count: 3, tone: "need" }],
    [0, events.slice(0, 2), memory(), { count: 2, tone: "news" }],
    [0, events, memory(["a", "b", "c"]), { count: 0, tone: "" }],
    [2, events, memory(["a", "b", "c"]), { count: 2, tone: "need" }],
    // A cleared event never counts, seen or not.
    [0, events, memory(["a"], ["b"]), { count: 1, tone: "news" }],
    [0, events, memory([], ["a", "b", "c"]), { count: 0, tone: "" }],
  ];
  for (const [waiting, list, known, expected] of cases)
    assert.deepEqual(bellNumber(waiting, list, known), expected);
});
