import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { canAccept, submitButton } from "#frame/review/send.mjs";

const read = (name) =>
  fs.readFile(new URL(`../../src/frame/${name}`, import.meta.url), "utf8");
const pages = await read("pages/pages.mjs");
const notes = await read("notes/notes.mjs");

test("note highlights are cleared before page and dialog text changes", () => {
  const showStart = pages.indexOf("function show(");
  const notesStart = pages.indexOf("\nexport function badge(", showStart);
  const show = pages.slice(showStart, notesStart);
  const openStart = notes.indexOf("function openNote(");
  const agreedStart = notes.indexOf(
    "\n/* A note that quotes nothing",
    openStart,
  );
  const open = notes.slice(openStart, agreedStart);

  const showClear = show.indexOf('clearHighlight("plan-note");');
  const pageReplacement = show.indexOf('$("page-content").innerHTML');
  assert.ok(showClear >= 0, "show clears the page's note highlight");
  assert.ok(showClear < pageReplacement);
  const openClear = open.indexOf('clearHighlight("plan-note");');
  const dialogText = open.indexOf('$("note-anchor").textContent');
  assert.ok(openClear >= 0, "openNote clears the dialog's note highlight");
  assert.ok(openClear < dialogText);
  const closeStart = notes.indexOf('$("note-dialog").addEventListener("close"');
  const close = notes.slice(closeStart, notes.indexOf("\n  });", closeStart));
  assert.ok(close.includes('!$("note-dialog").open'));
  assert.ok(close.includes('!$("reading").hidden'));
  assert.ok(close.includes('page.id !== "agreed"'));
  assert.ok(close.includes("markNotes();"));
});

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

test("page tabs leave the reader in place, while round choices open a page", async () => {
  const events = await read("app/events.mjs");
  const tabClick = events.slice(
    events.indexOf('const tab = event.target.closest("button[data-tab]");'),
    events.indexOf('const navigation = event.target.closest("[data-page]");'),
  );
  assert.match(
    tabClick,
    /switchTab\(tab\.dataset\.tab, null, \{ showPage: false \}\);/,
  );
  assert.doesNotMatch(tabClick, /\bshow\(/);

  const dialog = await read("sync/rounds-dialog.mjs");
  const roundClick = dialog.slice(
    dialog.indexOf("row.onclick = () => {"),
    dialog.indexOf("list.append(row);"),
  );
  assert.match(
    roundClick,
    /switchTab\("current", null, \{ showPage: true \}\);/,
  );

  const rounds = await read("sync/rounds.mjs");
  const pastOpen = rounds.slice(
    rounds.indexOf("async function openPast"),
    rounds.indexOf(
      "// Current's draft",
      rounds.indexOf("async function openPast"),
    ),
  );
  assert.match(
    pastOpen,
    /switchTab\("past", targetId, \{ showPage: true \}\);/,
  );
});
