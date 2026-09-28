import assert from "node:assert/strict";
import test from "node:test";
import { bellNumber, shareInView } from "../../../src/frame/sync/center.mjs";

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

test("an element's share of the reading area is the part of its height between the area's top and bottom", () => {
  const area = { top: 60, bottom: 900 };
  const box = (top, height) => ({ top, bottom: top + height, height });
  const cases = [
    [box(100, 100), 1],
    // Cut by the bottom of the window, as a reply below the fold is.
    [box(850, 100), 0.5],
    [box(875, 100), 0.25],
    // Cut by the top of the reading area.
    [box(10, 100), 0.5],
    [box(950, 100), 0],
    [box(-200, 100), 0],
    // A row inside a collapsed card has no height, and a missing row no box.
    [box(0, 0), 0],
    [undefined, 0],
  ];
  for (const [rect, share] of cases)
    assert.equal(shareInView(rect, area), share, JSON.stringify(rect));
});
