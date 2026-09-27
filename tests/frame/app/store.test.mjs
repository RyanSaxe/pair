import assert from "node:assert/strict";
import { test } from "node:test";
import { placeFor, readPlaces } from "../../../src/frame/app/places.mjs";
import {
  draftedWords,
  emptyDraft,
  loadDraft,
  markSent,
  submissionGroups,
  unsentItems,
} from "../../../src/frame/app/store.mjs";

const list = (label, touched = false) => ({
  kind: "multiple",
  topic: "scope",
  label,
  target: "multiselect-scope-0",
  round: "1",
  touched,
  options: [{ value: "a", label: "A", checked: true }],
});
const draftWith = (choices) => ({ ...emptyDraft("1"), choices });

test("alignment defaults on, preserves a changed value, and travels with feedback", () => {
  const fresh = emptyDraft("1");
  assert.equal(fresh.alignUnflagged, true);
  assert.equal(submissionGroups(fresh).alignUnflagged, true);
  fresh.alignUnflagged = false;
  assert.equal(submissionGroups(fresh).alignUnflagged, false);
  assert.equal(loadDraft(fresh, "2").alignUnflagged, false);
  const older = { ...fresh };
  delete older.alignUnflagged;
  assert.equal(loadDraft(older, "2").alignUnflagged, true);
});

test("an untouched checklist does not count", () => {
  const draft = draftWith({
    "scope/one": list("One"),
    "scope/two": list("Two"),
  });
  assert.equal(unsentItems(draft).count, 0);
  assert.deepEqual(Object.keys(submissionGroups(draft).choices), [
    "scope/one",
    "scope/two",
  ]);
});

test("a touched checklist counts once, even when put back", () => {
  const draft = draftWith({
    "scope/one": list("One", true),
    "scope/two": list("Two"),
  });
  assert.equal(unsentItems(draft).count, 1);
  assert.equal(submissionGroups(draft).choices["scope/one"].touched, true);
  assert.equal(submissionGroups(draft).choices["scope/two"].touched, false);
  assert.equal(
    unsentItems(draftWith({ "scope/one": list("One", true) })).count,
    1,
  );
});

test("a submit sends every list and the next round starts them fresh", () => {
  const draft = draftWith({
    "scope/one": list("One", true),
    "scope/two": list("Two"),
  });
  markSent(draft, "evt", "2026-09-18T00:00:00Z");
  assert.equal(draft.submitted.count, 1);
  assert.equal(draft.choices["scope/two"].sentIn, "evt");
  assert.equal(unsentItems(draft).count, 0);
  const next = loadDraft(JSON.parse(JSON.stringify(draft)), "2");
  assert.deepEqual(next.choices, {});
});

test("a touched, unsent list carries over to the next round", () => {
  const draft = draftWith({ "scope/one": list("One", true) });
  const next = loadDraft(JSON.parse(JSON.stringify(draft)), "2");
  assert.equal(next.choices["scope/one"].touched, true);
  assert.equal(unsentItems(next).count, 1);
});

test("single choices count as before", () => {
  const draft = draftWith({
    "d/pick": {
      topic: "d",
      label: "Pick",
      value: "x",
      valueLabel: "X",
      target: "t",
      round: "1",
    },
  });
  assert.equal(unsentItems(draft).count, 1);
});

test("the Review line names the comments and choices behind the count", () => {
  const draft = emptyDraft("1");
  assert.equal(draftedWords(draft), "");
  const note = (id) => ({ id, topic: "p", anchor: "P", quote: "", text: id });
  draft.notes.push(note("a"));
  assert.equal(draftedWords(draft), "1 comment");
  draft.notes.push(note("b"), note("c"));
  draft.choices["d/pick"] = { topic: "d", label: "Pick", value: "x" };
  assert.equal(draftedWords(draft), "3 comments and 1 choice");
  // A written answer is a comment, and an untouched checklist is not counted.
  draft.answers["d/why"] = { topic: "d", label: "Why", text: "Because." };
  draft.choices["scope/one"] = list("One");
  assert.equal(draftedWords(draft), "4 comments and 1 choice");
  assert.equal(
    draftedWords(draftWith({ "scope/one": list("One", true) })),
    "1 choice",
  );
  markSent(draft, "sent", "2026-01-01T00:00:00Z");
  assert.equal(draftedWords(draft), "");
});

test("each round keeps its own remembered place", () => {
  const pages = ["overview", "steps", "feedback"];
  const { tab, past, places } = readPlaces({
    tab: "past",
    past: "1",
    places: {
      1: { page: "steps", top: 640, tops: { steps: 640, overview: 120 } },
      2: { page: "overview", top: "x", tops: { overview: -3 } },
    },
  });
  assert.equal(tab, "past");
  assert.equal(past, "1");
  // Each page read keeps its own scroll position.
  assert.deepEqual(placeFor(places, "1", pages), {
    page: "steps",
    top: 640,
    tops: { steps: 640, overview: 120 },
  });
  assert.deepEqual(placeFor(places, "2", pages), {
    page: "overview",
    top: 0,
    tops: {},
  });
  // A round never visited opens at its first page.
  assert.equal(placeFor(places, "3", pages), null);
  // A page the round dropped would land the reader nowhere.
  assert.equal(placeFor(places, "1", ["overview", "feedback"]), null);
  assert.deepEqual(readPlaces(null), {
    tab: "current",
    past: null,
    places: {},
  });
});

test("drafts carry unsent items across rounds and drop what was sent", () => {
  const draft = emptyDraft("1");
  draft.notes.push({
    id: "n1",
    topic: "overview",
    anchor: "A",
    text: "one",
    round: "1",
  });
  draft.choices["overview/x"] = {
    topic: "overview",
    label: "X",
    value: "a",
    round: "1",
  };
  draft.answers["overview/q"] = {
    topic: "overview",
    label: "Q",
    text: "yes",
    round: "1",
  };
  assert.equal(unsentItems(draft).count, 3);
  assert.deepEqual(Object.keys(submissionGroups(draft)), [
    "alignUnflagged",
    "choices",
    "notes",
    "answers",
  ]);
  markSent(draft, "sub-1", "2000-01-01T00:00:00Z");
  assert.equal(unsentItems(draft).count, 0);
  assert.equal(draft.submitted.count, 3);
  assert.equal(draft.notes[0].sentIn, "sub-1");
  draft.notes.push({
    id: "n2",
    topic: "overview",
    anchor: "B",
    text: "two",
    round: "1",
  });
  assert.equal(unsentItems(draft).count, 1);
  const groups = submissionGroups(draft);
  assert.deepEqual(
    groups.notes.map((note) => note.id),
    ["n2"],
  );
  assert.equal("sentIn" in groups.notes[0], false);
  assert.equal("answers" in groups, false);
  draft.acceptance = {
    id: "accept-1",
    action: "implement",
    guidance: "Do this",
  };
  draft.acceptGuidance = "Do this";
  const same = loadDraft(JSON.parse(JSON.stringify(draft)), "1");
  assert.equal(same.notes.length, 2);
  assert.equal(same.submitted.id, "sub-1");
  assert.equal(same.acceptGuidance, "Do this");
  const next = loadDraft(JSON.parse(JSON.stringify(draft)), "2");
  assert.deepEqual(
    next.notes.map((note) => note.id),
    ["n2"],
  );
  assert.deepEqual(next.choices, {});
  assert.deepEqual(next.answers, {});
  assert.equal(next.submitted, null);
  assert.equal(next.acceptance, null);
  assert.equal(next.acceptGuidance, "");
  assert.equal(next.round, "2");
  assert.deepEqual(loadDraft(null, "3"), emptyDraft("3"));
  assert.deepEqual(loadDraft({ notes: "bad" }, "3"), emptyDraft("3"));
});
