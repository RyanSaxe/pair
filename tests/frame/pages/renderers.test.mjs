import assert from "node:assert/strict";
import { test } from "node:test";
import { diffHeight } from "#frame/pages/renderers.mjs";

// These sizes are browser measurements of @pierre/diffs 1.6.2. Each row is 22px
// tall, and each "N unmodified lines" separator is 32px tall. A separator has
// 8px of space below it, and 8px above it when it follows a hunk. The rows of a
// diff have 8px of space above and below them.
const ROW = 22;
const SEPARATOR = 32;
const SPACE = 8;
const header = "diff --git a/f.mjs b/f.mjs\n--- a/f.mjs\n+++ b/f.mjs\n";

test("diffHeight counts rows and separators of a patch with two hunks", () => {
  const patch =
    header +
    "@@ -10,3 +10,4 @@\n context\n-old\n+new\n+added\n context\n" +
    "@@ -20,3 +21,2 @@\n context\n-gone\n-also gone\n context\n";
  const separators = 2 * SEPARATOR + 3 * SPACE;
  // In split view, the hunks have 1 + max(1, 2) + 1 rows and 1 + max(2, 0) + 1
  // rows.
  assert.equal(diffHeight(patch, "split"), 8 * ROW + separators + 2 * SPACE);
  // In unified view, the hunks have 1 + 3 + 1 rows and 1 + 2 + 1 rows.
  assert.equal(diffHeight(patch, "unified"), 9 * ROW + separators + 2 * SPACE);
});

test("diffHeight puts no separator before a hunk at line 1 or right after another", () => {
  const patch =
    header +
    "@@ -1,2 +1,2 @@\n-a\n+A\n b\n" +
    "@@ -3,2 +3,2 @@\n c\n-d\n+D\n\\ No newline at end of file\n";
  // In split view, the hunks have max(1, 1) + 1 rows and 1 + max(1, 1) rows,
  // plus one row for the no-newline marker.
  assert.equal(diffHeight(patch, "split"), 5 * ROW + 2 * SPACE);
  // In unified view, the hunks have 2 + 1 rows and 1 + 2 rows, plus the marker,
  // which shows for the added side only.
  assert.equal(diffHeight(patch, "unified"), 7 * ROW + 2 * SPACE);
});
