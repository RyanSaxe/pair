import assert from "node:assert/strict";
import test from "node:test";
import {
  threadAccepts,
  threadState,
  upgradeThread,
} from "../../src/shared/thread-state.mjs";

const asks = { from: "reviewer", at: "2026-11-08T12:00:00.000Z" };
const reply = (answers) => ({
  from: "agent",
  ...(answers === undefined ? {} : { answers }),
});

// The hub tests in tests/hub/session/threads.test.mjs reach the sent, read and
// replied states and their wakes. No hub test adds a message while a wake
// waits to go out, which joins that wake, or adds one after a failed wake,
// which wakes the holder again.
test("a thread whose wake waits to go out takes no other wake, and a thread whose wake failed takes one", () => {
  for (const [thread, expected, actions] of [
    [{ messages: [asks] }, "sending", ["read"]],
    [
      { messages: [asks], wake: { ok: false, through: 1 } },
      "failed",
      ["wake", "read"],
    ],
  ]) {
    assert.equal(threadState(thread), expected, JSON.stringify(thread));
    assert.deepEqual(
      ["wake", "read"].filter((action) => threadAccepts(thread, action)),
      actions,
    );
  }
});

// pair reply --ack answers the messages that a reply in its place would. The
// reviewer's next message waits again, and a reply after an ack is replied.
test("an ack answers the waiting messages, takes none once nothing waits, and gives way to a later message or reply", () => {
  const ack = (answers) => ({ ...reply(answers), kind: "ack" });
  const sent = { ok: true, through: 3 };
  for (const [thread, expected, acks] of [
    [{ messages: [asks], readCount: 1 }, "read", true],
    [{ messages: [asks, ack()] }, "agentAcknowledged", false],
    [{ messages: [asks, ack(), asks], wake: sent }, "sent", true],
    [{ messages: [asks, ack(), reply()] }, "replied", false],
    [{ messages: [asks, asks, ack(1)], wake: sent }, "sent", true],
  ]) {
    assert.equal(threadState(thread), expected, JSON.stringify(thread));
    assert.equal(threadAccepts(thread, "ack"), acks, JSON.stringify(thread));
  }
  assert.equal(threadAccepts({ messages: [asks, ack()] }, "wake"), true);
});

// A session saved before the facts stored each thread's state.
test("upgradeThread gives a thread saved with its state the same state", () => {
  const followed = [asks, asks, reply(1)];
  for (const thread of [
    { state: "sending", messages: [asks] },
    { state: "sending", messages: [asks, reply(), asks], wake: { ok: true } },
    { state: "sent", messages: [asks], wake: { ok: true } },
    { state: "failed", messages: [asks], wake: { ok: false, reason: "gone" } },
    { state: "read", messages: [asks], wake: { ok: true }, readAt: asks.at },
    { state: "replied", messages: [asks, reply()], wake: { ok: true } },
    { state: "sent", messages: followed, readCount: 1, wake: { ok: true } },
  ]) {
    const upgraded = upgradeThread(thread);
    assert.equal(upgraded.state, undefined);
    assert.equal(threadState(upgraded), thread.state, JSON.stringify(thread));
  }
});
