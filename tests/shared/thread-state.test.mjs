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
const sent = (through) => ({ ok: true, through });

// Each row is a thread's stored facts, the state they give, and the actions
// that state accepts. The follow-up rows are the bug where a reply posted
// after the reviewer's follow-up marked the follow-up answered.
test("threadState works a thread's state out from what the agent read, what each reply answers and the last wake", () => {
  for (const [thread, expected, actions] of [
    [{ messages: [asks] }, "sending", ["read"]],
    [{ messages: [asks], wake: sent(1) }, "sent", ["wake", "read"]],
    [
      { messages: [asks], wake: { ok: false, through: 1 } },
      "failed",
      ["wake", "read"],
    ],
    [{ messages: [asks], wake: sent(1), readCount: 1 }, "read", ["wake"]],
    [{ messages: [asks, reply()], readCount: 1 }, "replied", ["wake"]],
    [
      { messages: [asks, reply(), asks], wake: sent(2), readCount: 1 },
      "sending",
      ["read"],
    ],
    [
      { messages: [asks, asks, reply(1)], wake: sent(2), readCount: 1 },
      "sent",
      ["wake", "read"],
    ],
    [
      { messages: [asks, asks, reply(1)], wake: sent(2), readCount: 3 },
      "read",
      ["wake"],
    ],
  ]) {
    assert.equal(threadState(thread), expected, JSON.stringify(thread));
    assert.deepEqual(
      ["wake", "read"].filter((action) => threadAccepts(thread, action)),
      actions,
    );
  }
});

// The hub refuses every reply in a closed session.
test("in a closed session, a thread that waits for the agent is unanswered", () => {
  const read = { messages: [asks], wake: sent(1), readCount: 1 };
  assert.equal(threadState(read, true), "unanswered");
  assert.equal(threadState({ messages: [asks, reply()] }, true), "replied");
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
