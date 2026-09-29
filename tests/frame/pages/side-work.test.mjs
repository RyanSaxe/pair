import assert from "node:assert/strict";
import { test } from "node:test";
import { openCount } from "../../../src/frame/pages/side-work.mjs";

test("openCount counts recorded, started, working and pull-request items", () => {
  const items = [
    "recorded",
    "started",
    "working",
    "pr",
    "done",
    "dropped",
    "planned",
  ];
  assert.equal(openCount(items.map((state) => ({ state }))), 4);
});

test("openCount returns zero when every side-work item is finished", () => {
  assert.equal(openCount([{ state: "done" }, { state: "dropped" }]), 0);
});
