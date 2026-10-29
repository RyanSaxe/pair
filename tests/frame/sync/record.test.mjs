import assert from "node:assert/strict";
import test from "node:test";
import { hubRecord } from "../../../src/frame/sync/record.mjs";

// Node has no localStorage, so each record keeps its copy in memory, as a
// browser with storage blocked does. The hub is the fetch to /api/seen.
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
  // Opened before the hub kept a record, or while it was unreachable.
  record.sync(undefined, keep, () => new Set());
  record.add(["a/1/agreed"]);
  record.sync(null, keep, () => new Set(["a/1/agreed", "a/1/keys"]));
  assert.deepEqual(sent, [{ url: "/api/seen", opened: ["a/1/agreed"] }]);
  // Another browser opened a/1/keys, and this one opened a/1/retry while
  // the hub did not answer.
  record.add(["a/1/retry"]);
  record.sync(["a/1/agreed", "a/1/keys"], keep);
  assert.deepEqual(sent.at(-1), { url: "/api/seen", opened: ["a/1/retry"] });
  assert.deepEqual([...record.load()].sort(), [
    "a/1/agreed",
    "a/1/keys",
    "a/1/retry",
  ]);
  // Once the hub has every ID, a list sends nothing.
  const count = sent.length;
  record.sync(["a/1/agreed", "a/1/keys", "a/1/retry"], keep);
  assert.equal(sent.length, count);
});
