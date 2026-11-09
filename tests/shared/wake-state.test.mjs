import assert from "node:assert/strict";
import test from "node:test";
import { wakeAccepts, wakeState } from "../../src/shared/wake-state.mjs";

const at = (minute) => `2026-11-08T12:0${minute}:00.000Z`;
const sent = (minute) => ({ last: { at: at(minute), ok: true } });
const failed = (minute) => ({
  last: { at: at(minute), ok: false, reason: "gone" },
});
const command = (minute) => ({ holder: { commandAt: at(minute) } });

// tests/hub/wake.test.mjs and tests/hub/session/restart-wakes.test.mjs reach
// an owed wake, a sent one, and a failed one before and after the holder's
// next command. No hub test reaches these rows: a command that answers a send
// before its wake goes out, so a restarted hub owes no wake, a command after a
// sent wake, which pair status still names as sent, and a send saved after the
// last wake, which has no wake yet.
test("wakeState works the wake out from the newest send, the last wake and the holder's last command", () => {
  for (const [facts, expected, actions] of [
    [{ sentAt: at(1), ...command(2) }, "answered", []],
    [{ sentAt: at(1), wake: sent(2), ...command(3) }, "sent", []],
    [{ sentAt: at(3), wake: failed(2) }, "owed", ["send"]],
    [{ sentAt: at(3), wake: sent(2) }, "owed", ["send"]],
  ]) {
    assert.equal(wakeState(facts), expected, JSON.stringify(facts));
    assert.deepEqual(
      ["send", "alert"].filter((action) => wakeAccepts(facts, action)),
      actions,
    );
  }
});
