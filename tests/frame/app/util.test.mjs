import assert from "node:assert/strict";
import { test } from "node:test";
import { occurrenceAt, occurrenceIndex } from "../../../src/frame/app/util.mjs";

// A block's text as the frame reads it, with the selected words twice.
const text =
  "Items go to the queue first, and a failed item goes back to the queue.";
const words = "the queue";

test("a note on words its block repeats finds the appearance the reviewer selected", () => {
  const first = text.indexOf(words);
  const second = text.lastIndexOf(words);
  assert.equal(occurrenceAt(text, words, first), 1);
  assert.equal(occurrenceAt(text, words, second), 2);
  for (const start of [first, second])
    assert.equal(
      occurrenceIndex(text, words, occurrenceAt(text, words, start)),
      start,
    );
  // A note with no occurrence is on the first, and one past the last is on
  // none.
  assert.equal(occurrenceIndex(text, words), first);
  assert.equal(occurrenceIndex(text, words, 3), -1);
});
