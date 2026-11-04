import assert from "node:assert/strict";
import { test } from "node:test";
import { itemId } from "#frame/pages/new-item.mjs";

// The hub refuses a card whose ID is not a slug of at most 60 characters.
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

test("itemId turns any title into a slug the session does not have", () => {
  for (const [title, taken, id] of [
    ["Add a dark theme!", [], "add-a-dark-theme"],
    ["Café  menü", [], "cafe-menu"],
    ["夜間テーマ", [], "item"],
    ["Fix it", ["fix-it"], "fix-it-2"],
    ["Fix it", ["fix-it", "fix-it-2"], "fix-it-3"],
  ])
    assert.equal(itemId(title, taken), id);
  const long = itemId(`${"long words here ".repeat(8)}`, []);
  assert.match(long, slug);
  assert.ok(long.length <= 60);
});
