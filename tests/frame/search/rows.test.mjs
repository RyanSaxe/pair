import assert from "node:assert/strict";
import { test } from "node:test";
import { hasOwnText, whereLine } from "#frame/search/rows.mjs";

const row = {
  sessionTitle: "Get pair ready for a wider release",
  round: "13",
  pageTitle: "The search modal",
  heading: "Keys",
  text: "Ctrl+J moves down.",
  also: ["11"],
};

test("a row's where line ends with the session, the part an ellipsis can lose", () => {
  assert.equal(
    whereLine(row, { allSessions: true }),
    "Round 13 · The search modal · also in 1 earlier · Get pair ready for a wider release",
  );
  assert.equal(
    whereLine(row, { allSessions: false }),
    "Round 13 · The search modal · also in 1 earlier",
  );
});

test("a row repeats neither its title nor its page on a second line", () => {
  const pageRow = { ...row, heading: "", also: [] };
  assert.equal(whereLine(pageRow, { allSessions: false }), "Round 13");
  assert.equal(hasOwnText({ ...row, heading: "Keys", text: "Keys" }), false);
  assert.equal(hasOwnText({ ...pageRow, text: "" }), false);
  assert.equal(hasOwnText(row), true);
});
