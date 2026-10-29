import assert from "node:assert/strict";
import test from "node:test";
import { hubRecord } from "../../../src/frame/sync/record.mjs";

// Node has no localStorage, so hubRecord stores its copy in memory, as it does
// in a browser that blocks storage. This fetch stub stands in for the hub's
// /api/seen route.
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, ...JSON.parse(init.body) });
  return { ok: true };
};
const keep = (ids) => ids;

test("a browser and a hub with no record start with everything listed, and a hub that keeps none gets nothing", () => {
  sent.length = 0;
  const record = hubRecord("cleared", "test:a");
  record.sync(undefined, keep, () => new Set(["e1", "e2"]));
  assert.deepEqual([...record.load()], ["e1", "e2"]);
  record.add(["e3"]);
  assert.deepEqual(sent, []);
  const fresh = hubRecord("cleared", "test:b");
  fresh.sync(null, keep, () => new Set(["e1"]));
  assert.deepEqual(sent, [{ url: "/api/seen", cleared: ["e1"] }]);
});

test("a browser's own record goes to a hub with none, and what the hub lacks goes to a hub with one", () => {
  sent.length = 0;
  const record = hubRecord("opened", "test:c");
  // With hub undefined, as from an older hub that keeps no lists, add() posts
  // nothing, so a/1/agreed exists only in this browser.
  record.sync(undefined, keep, () => new Set());
  record.add(["a/1/agreed"]);
  record.sync(null, keep, () => new Set(["a/1/agreed", "a/1/keys"]));
  assert.deepEqual(sent, [{ url: "/api/seen", opened: ["a/1/agreed"] }]);
  // The hub's list contains a/1/keys from another browser and lacks a/1/retry,
  // as if the post from add() had failed.
  record.add(["a/1/retry"]);
  record.sync(["a/1/agreed", "a/1/keys"], keep);
  assert.deepEqual(sent.at(-1), { url: "/api/seen", opened: ["a/1/retry"] });
  assert.deepEqual([...record.load()].sort(), [
    "a/1/agreed",
    "a/1/keys",
    "a/1/retry",
  ]);
  const count = sent.length;
  record.sync(["a/1/agreed", "a/1/keys", "a/1/retry"], keep);
  assert.equal(sent.length, count);
});
