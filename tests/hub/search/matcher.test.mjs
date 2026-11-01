import assert from "node:assert/strict";
import test from "node:test";
import { prepare, scoreDoc } from "../../../src/hub/search/matcher.mjs";

const score = (query, heading, text) =>
  scoreDoc(prepare(query), { heading, text, at: 0 });

test("each way of matching a word finds the document", () => {
  for (const [why, query, heading, text] of [
    ["whole word", "retry", "", "We retry the request."],
    ["word start", "retr", "", "We retry the request."],
    ["inside a word", "etr", "", "We retry the request."],
    ["any order", "request retry", "", "We retry the request."],
    ["camelCase part", "limit", "", "const retryLimit = 3;"],
    ["initials in a heading", "wsl", "Windows Subsystem Linux", ""],
    ["letters in order", "rtry", "", "We retry the request."],
    ["one typo", "reqest", "", "We retry the request."],
    ["two typos in a long word", "backofffs", "", "exponential backoff"],
  ])
    assert.ok(score(query, heading, text), why);
});

test("a word that is nowhere fails the document", () => {
  assert.equal(score("zebra", "Retries", "We retry the request."), null);
  assert.equal(score("retry zebra", "", "We retry the request."), null);
});

test("better matches score higher", () => {
  const body = "Retries use backoff, and nothing else changes here.";
  const better = [
    [
      "a heading over the text",
      ["backoff", "backoff", ""],
      ["backoff", "", body],
    ],
    [
      "a whole word over a word start",
      ["back", "", "go back"],
      ["back", "", "backoff"],
    ],
    [
      "a phrase over scattered words",
      ["use backoff", "", body],
      ["use backoff", "", "backoff, as you use it"],
    ],
  ];
  for (const [why, a, b] of better)
    assert.ok(score(...a).score > score(...b).score, why);
});

test("ranges point at the words that matched", () => {
  const text = "We retry the request.";
  const { textRanges } = score("retry request", "", text);
  assert.deepEqual(
    textRanges.map(([from, to]) => text.slice(from, to)),
    ["retry", "request"],
  );
});

test("one letter matches only titles", () => {
  const prepared = prepare("r");
  const doc = (type) => ({ heading: "Retries", text: "", type, at: 0 });
  assert.ok(scoreDoc(prepared, doc("page title")));
  assert.equal(scoreDoc(prepared, doc("page block")), null);
});
