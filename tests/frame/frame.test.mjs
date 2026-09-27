import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const frame = await fs.readFile(
  new URL("../../src/frame/frame.js", import.meta.url),
  "utf8",
);

test("note highlights are cleared before page and dialog text changes", () => {
  const showStart = frame.indexOf("function show(");
  const notesStart = frame.indexOf("\n/* Notes on the text */", showStart);
  const show = frame.slice(showStart, notesStart);
  const openStart = frame.indexOf("function openNote(");
  const agreedStart = frame.indexOf("\n/* Agreed */", openStart);
  const open = frame.slice(openStart, agreedStart);

  const showClear = show.indexOf('clearHighlight("plan-note");');
  const pageReplacement = show.indexOf('$("page-content").innerHTML');
  assert.ok(showClear >= 0, "show clears the page's note highlight");
  assert.ok(showClear < pageReplacement);
  const openClear = open.indexOf('clearHighlight("plan-note");');
  const dialogText = open.indexOf('$("note-anchor").textContent');
  assert.ok(openClear >= 0, "openNote clears the dialog's note highlight");
  assert.ok(openClear < dialogText);
  const closeStart = frame.indexOf('$("note-dialog").addEventListener("close"');
  const close = frame.slice(closeStart, frame.indexOf("\n});", closeStart));
  assert.ok(close.includes('!$("note-dialog").open'));
  assert.ok(close.includes('!$("reading").hidden'));
  assert.ok(close.includes('page.id !== "agreed"'));
  assert.ok(close.includes("markNotes();"));
});

const between = (start, end) =>
  frame.slice(frame.indexOf(start), frame.indexOf(end, frame.indexOf(start)));

test("every page sets its own note line, Agreed and unfinished pages included", () => {
  const show = between("function show(", "\n/* Notes on the text */");
  const branch = show.indexOf("renderAgreements();");
  const count = show.indexOf("countNotes();");
  assert.ok(branch >= 0 && count > branch, "show counts after the page branch");
  const counted = show.slice(show.lastIndexOf("}", count), count);
  assert.ok(
    !counted.includes("pending"),
    "the count does not depend on the branch",
  );
  const mark = between("function markNotes(", "\nfunction countNotes(");
  assert.ok(mark.includes("countNotes();"));
  assert.ok(
    !mark.includes('$("note-count")'),
    "only countNotes writes the line",
  );
});

test("a send keeps the reader on Current", () => {
  assert.ok(!frame.includes('switchTab("past")'));
});

test("drafting a comment never hides the way to accept a final plan", () => {
  const accept = between("function canAccept(", "\n}");
  assert.ok(!/unsent/i.test(accept));
});

test("the build's language list is the one for the Shiki the frame loads", async () => {
  const frame = await fs.readFile(
    new URL("../../src/frame/frame.js", import.meta.url),
    "utf8",
  );
  const list = JSON.parse(
    await fs.readFile(
      new URL("../../src/build/shiki-languages.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(frame.match(/esm\.sh\/shiki@([\d.]+)/)[1], list.shiki);
});

test("page tabs leave the reader in place, while round choices open a page", async () => {
  const frame = await fs.readFile(
    new URL("../../src/frame/frame.js", import.meta.url),
    "utf8",
  );
  const tabClick = frame.slice(
    frame.indexOf('const tab = event.target.closest("button[data-tab]");'),
    frame.indexOf('const navigation = event.target.closest("[data-page]");'),
  );
  assert.match(
    tabClick,
    /switchTab\(tab\.dataset\.tab, null, \{ showPage: false \}\);/,
  );
  assert.doesNotMatch(tabClick, /\bshow\(/);

  const roundClick = frame.slice(
    frame.indexOf("row.onclick = () => {"),
    frame.indexOf("list.append(row);"),
  );
  assert.match(
    roundClick,
    /switchTab\("current", null, \{ showPage: true \}\);/,
  );

  const pastOpen = frame.slice(
    frame.indexOf("async function openPast"),
    frame.indexOf(
      "// Current's draft",
      frame.indexOf("async function openPast"),
    ),
  );
  assert.match(
    pastOpen,
    /switchTab\("past", targetId, \{ showPage: true \}\);/,
  );
});
