import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { canAccept, submitButton } from "#frame/review/send.mjs";

const read = (name) =>
  fs.readFile(new URL(`../../src/frame/${name}`, import.meta.url), "utf8");
const pages = await read("pages/pages.mjs");
const notes = await read("notes/notes.mjs");

const between = (source, start, end) =>
  source.slice(
    source.indexOf(start),
    source.indexOf(end, source.indexOf(start)),
  );

test("every page sets its own note line, Agreed and unfinished pages included", () => {
  const show = between(pages, "function show(", "\nexport function badge(");
  const branch = show.indexOf("renderAgreements();");
  const count = show.indexOf("countNotes();");
  assert.ok(branch >= 0 && count > branch, "show counts after the page branch");
  const counted = show.slice(show.lastIndexOf("}", count), count);
  assert.ok(
    !counted.includes("pending"),
    "the count does not depend on the branch",
  );
  const mark = between(
    notes,
    "function markNotes(",
    "\nexport function countNotes(",
  );
  assert.ok(mark.includes("countNotes();"));
  assert.ok(
    !mark.includes('$("note-count")'),
    "only countNotes writes the line",
  );
});

test("drafting a comment never hides the way to accept a final plan", () => {
  const finishing = {
    inFlight: false,
    opensFeedback: false,
    onSentFeedback: false,
    finishes: true,
    finishable: canAccept({
      offer: "plan",
      connected: true,
      current: true,
      submitted: false,
      stage: "updated",
    }),
    waitingForPages: false,
    sendable: true,
    alignUnflagged: true,
  };
  assert.deepEqual(submitButton({ ...finishing, pending: 0 }), {
    disabled: false,
    text: "Finish review",
    primary: true,
  });
  assert.deepEqual(submitButton({ ...finishing, pending: 2 }), {
    disabled: false,
    text: "Finish review (2)",
    primary: true,
  });
});

test("the build's language list is the one for the Shiki the frame loads", async () => {
  const frame = await read("pages/renderers.mjs");
  const list = JSON.parse(
    await fs.readFile(
      new URL("../../src/build/shiki-languages.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(frame.match(/esm\.sh\/shiki@([\d.]+)/)[1], list.shiki);
});
