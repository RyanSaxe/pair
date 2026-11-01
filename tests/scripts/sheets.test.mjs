import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedIds } from "../../scripts/screenshots/sheets.mjs";

const run = (session, thread, submission) => [
  {
    cmd: `pair reply --session-dir …/${session} --thread ${thread}…`,
    out: [`Posted your reply in thread ${thread}…`],
  },
  {
    cmd: `pair read --session-dir …/${session}`,
    out: [`<pair_feedback submission="${submission}…" round="2">`],
  },
];

test("fixedIds draws the same terminal for different IDs, and keeps IDs distinct", () => {
  const first = fixedIds(run("add70e4e", "f0bc3705", "ecb5dc72"));
  const second = fixedIds(run("4e642d62", "b74e672e", "601e298a"));
  assert.deepEqual(first, second);
  const [reply, read] = first;
  const session = reply.cmd.match(/…\/([0-9a-f]{8})/)[1];
  const thread = reply.out[0].match(/([0-9a-f]{8})…/)[1];
  const submission = read.out[0].match(/([0-9a-f]{8})…/)[1];
  assert.notEqual(session, "add70e4e");
  assert.equal(read.cmd.match(/…\/([0-9a-f]{8})/)[1], session);
  assert.equal(new Set([session, thread, submission]).size, 3);
});
