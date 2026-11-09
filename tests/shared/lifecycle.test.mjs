import assert from "node:assert/strict";
import test from "node:test";
import { accepts, lifecycle, roundStage } from "../../src/shared/lifecycle.mjs";

const at = "2026-11-08T12:00:00.000Z";
const pause = { at, reason: "Done for today" };

// Close leaves a pause in place, so a session its agent paused before the
// reviewer closed it has both fields, and it is closed.
test("lifecycle names a session live, paused or closed from closedAt and paused", () => {
  for (const [state, expected, actions] of [
    [{}, "live", ["change", "wake"]],
    [{ paused: pause }, "paused", ["change"]],
    [{ closedAt: at }, "closed", ["reopen"]],
    [{ closedAt: at, paused: pause }, "closed", ["reopen"]],
  ]) {
    assert.equal(lifecycle(state), expected);
    assert.deepEqual(
      ["change", "wake", "reopen"].filter((action) => accepts(state, action)),
      actions,
    );
  }
});

// The round passes through each stage once per round: Agreed of round 1,
// its last page, the reviewer's send, pair read, the next round's Agreed and
// its last page.
test("roundStage works the round's stage out from the round fields", () => {
  const one = { round: "1" };
  const two = { round: "2" };
  for (const [state, unread, expected] of [
    [{ current: null }, false, "ready"],
    [{ current: one, openRound: { round: "1" } }, false, "working"],
    [{ current: one, openRound: null }, false, "updated"],
    [{ current: one, latestSubmissionRound: "1" }, true, "submitted"],
    [{ current: one, latestSubmissionRound: "1" }, false, "working"],
    [{ current: two, openRound: { round: "2" } }, false, "working"],
    [{ current: two, latestSubmissionRound: "1" }, false, "updated"],
  ])
    assert.equal(roundStage(state, unread), expected);
});
