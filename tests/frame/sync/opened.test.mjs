import assert from "node:assert/strict";
import test from "node:test";
import {
  countUnopened,
  pageKey,
  settle,
} from "../../../src/frame/sync/opened.mjs";

const listed = (id, round, ids) => ({ id, readyPages: { round, ids } });

test("a browser with no record adopts every listed page as opened, so nothing starts new", () => {
  const sessions = [
    listed("a", "2", ["agreed", "retry"]),
    listed("b", "1", ["agreed"]),
  ];
  const opened = settle(sessions, null);
  for (const entry of sessions) assert.equal(countUnopened(entry, opened), 0);
  // A page that publishes afterwards counts until it is opened.
  const next = listed("a", "2", ["agreed", "retry", "keys"]);
  assert.equal(countUnopened(next, opened), 1);
  opened.add(pageKey("a", "2", "keys"));
  assert.equal(countUnopened(next, opened), 0);
});

test("the record forgets sessions the hub no longer lists and rounds a session moved on from", () => {
  const opened = new Set([
    pageKey("a", "1", "agreed"),
    pageKey("a", "2", "agreed"),
    pageKey("b", "1", "agreed"),
  ]);
  assert.deepEqual(
    [...settle([listed("a", "2", ["agreed", "retry"])], opened)],
    [pageKey("a", "2", "agreed")],
  );
  // The next round's pages are new records, so a page that continues under
  // the same ID counts again.
  assert.equal(countUnopened(listed("a", "3", ["agreed"]), opened), 1);
});
