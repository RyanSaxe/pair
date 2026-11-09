import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryState,
  wakeAccepts,
  wakeState,
} from "../../src/shared/wake-state.mjs";

const at = (minute) => `2026-11-08T12:0${minute}:00.000Z`;
const sent = (minute) => ({ last: { at: at(minute), ok: true } });
const failed = (minute) => ({
  last: { at: at(minute), ok: false, reason: "gone" },
});
const command = (minute) => ({ holder: { commandAt: at(minute) } });

// Each row is a session's stored facts, the state of the newest send's wake,
// and the actions that state accepts. The answered rows after a failed wake
// are the bug where "Could not wake the agent" stayed after the holder ran
// pair read and published its pages.
test("wakeState works the wake out from the newest send, the last wake and the holder's last command", () => {
  for (const [facts, expected, actions] of [
    [{}, null, []],
    [{ sentAt: at(1) }, "owed", ["send"]],
    [{ sentAt: at(1), ...command(0) }, "owed", ["send"]],
    [{ sentAt: at(1), ...command(2) }, "answered", []],
    [{ sentAt: at(1), wake: sent(2) }, "sent", []],
    [{ sentAt: at(1), wake: sent(2), ...command(3) }, "sent", []],
    [{ sentAt: at(1), wake: failed(2) }, "failed", ["alert"]],
    [{ sentAt: at(1), wake: failed(2), ...command(3) }, "answered", []],
    // A send saved after the last wake has no wake yet.
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

// pair read and pair progress record the agent's progress on the latest
// submission, and the wake gives the state before the agent received it.
test("deliveryState works out how far the latest submission got", () => {
  const latest = { latestSubmissionId: "s2", sentAt: at(1) };
  for (const [facts, expected] of [
    [{}, null],
    [latest, "saved"],
    [{ ...latest, wake: sent(2) }, "sent"],
    [{ ...latest, wake: failed(2) }, "failed"],
    [{ ...latest, wake: failed(2), ...command(3) }, "sent"],
    [{ ...latest, wake: failed(2), lastReceivedId: "s2" }, "received"],
    [{ ...latest, lastReceivedId: "s2", lastAcknowledgedId: "s1" }, "received"],
    [{ ...latest, wake: failed(2), lastAcknowledgedId: "s2" }, "read"],
  ])
    assert.equal(deliveryState(facts), expected, JSON.stringify(facts));
});
