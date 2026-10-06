import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

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

  const panel = await read("sync/rounds-panel.mjs");
  const roundClick = panel.slice(
    panel.indexOf("row.onclick = () => {"),
    panel.indexOf("list.append(line);"),
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
