import assert from "node:assert/strict";
import { test } from "node:test";
import { blockTargets } from "../../../src/frame/notes/blocks.mjs";

// blockTargets reads only each block's tag and ID, so plain objects stand in
// for the page's blocks.
test("every block gets an ID, a paragraph's and a heading's included, so words selected in one record it", () => {
  const block = (tagName, id = "") => ({ tagName, id });
  const root = {
    children: [
      block("P"),
      block("H2"),
      block("PRE"),
      block("P"),
      block("H2", "limits"),
      block("UL"),
    ],
  };
  blockTargets(root, "overview");
  assert.deepEqual(
    root.children.map((item) => item.id),
    [
      "block-overview-0",
      "block-overview-1",
      "block-overview-2",
      "block-overview-3",
      "limits",
      "block-overview-5",
    ],
  );
});
