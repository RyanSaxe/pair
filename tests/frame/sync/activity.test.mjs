import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityModel,
  agentNotice,
  finishedLine,
  roundModel,
} from "../../../src/frame/sync/activity.mjs";

const now = Date.parse("2026-01-01T00:10:00Z");
const submittedRound = "1";
const currentSet = {
  pages: [
    { id: "agreed", title: "Agreed so far", state: "ready" },
    { id: "overview", title: "Overview", state: "active" },
    { id: "detail", title: "Detail", state: "queued" },
  ],
};
const read = { latestSubmissionId: "s2", lastAcknowledgedId: "s2" };
const run = (remote, extra = {}) =>
  activityModel({ remote, currentSet, submittedRound, now, ...extra });

test("feedback waits without inventing page names", () => {
  // An acknowledgement from an earlier round does not count for this one.
  const waiting = run({
    current: { round: "1" },
    latestSubmissionId: "s2",
    lastAcknowledgedId: "s1",
    acknowledgedAt: "2026-01-01T00:01:00Z",
    updatedAt: "2026-01-01T00:02:00Z",
  });
  assert.equal(waiting.title, "Waiting for the agent");
  assert.deepEqual(waiting.slots, []);
  assert.equal(waiting.track, "still");
  assert.deepEqual(waiting.footer, {
    mark: "queued",
    text: "No agent report yet",
  });
  const sending = run({ current: { round: "1" } }, { inFlight: true });
  assert.equal(sending.title, "Sending feedback");
  assert.equal(sending.track, "moving");
  assert.equal(sending.footer.mark, "active");
  const acknowledged = run({
    current: { round: "1" },
    ...read,
    acknowledgedAt: "2026-01-01T00:09:20Z",
  });
  assert.equal(acknowledged.title, "Preparing the next round");
  assert.deepEqual(acknowledged.slots, []);
  assert.equal(acknowledged.track, "moving");
  assert.deepEqual(acknowledged.footer, {
    mark: "active",
    text: "Agent read your feedback",
    at: "2026-01-01T00:09:20Z",
    late: false,
  });
});

test("published page names keep their order while readiness changes", () => {
  const model = run({
    current: { round: "2" },
    ...read,
    updatedAt: "2026-01-01T00:09:00Z",
  });
  assert.equal(model.title, "Pages in progress");
  assert.equal(model.summary, "1 of 3 pages ready");
  assert.equal(model.track, null);
  assert.deepEqual(
    model.slots.map((item) => item.id),
    ["agreed", "overview", "detail"],
  );
  assert.deepEqual(model.footer, {
    mark: "active",
    text: "Last report",
    at: "2026-01-01T00:09:00Z",
    late: false,
  });
  const finished = run(
    {
      current: { round: "2", publishedAt: "2026-01-01T00:08:00Z" },
      ...read,
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      currentSet: {
        pages: currentSet.pages.map((item) => ({ ...item, state: "ready" })),
      },
    },
  );
  assert.equal(finished.title, "All pages ready");
  assert.deepEqual(finished.footer, {
    mark: "complete",
    text: "Finished",
    at: "2026-01-01T00:08:00Z",
  });
});

test("a report older than five minutes turns late and pause or wake failure wins", () => {
  const remote = {
    current: { round: "2" },
    ...read,
    updatedAt: "2026-01-01T00:05:00Z",
  };
  assert.equal(
    run(remote, { now: Date.parse("2026-01-01T00:09:59Z") }).footer.late,
    false,
  );
  assert.equal(run(remote).footer.late, true);
  assert.equal(run(remote).footer.text, "Last report");
  const paused = run({ ...remote, paused: { reason: "Waiting for input" } });
  assert.equal(paused.stopped, true);
  assert.equal(paused.footer.mark, "stopped");
  assert.match(
    paused.footer.text,
    /Waiting for input\. Send a message in chat/,
  );
  const failed = run({
    ...remote,
    wake: { last: { ok: false } },
    paused: { reason: "Waiting" },
  });
  assert.match(failed.footer.text, /Could not wake the agent/);
  const pausedEarly = run({
    current: { round: "1" },
    ...read,
    paused: { reason: "Waiting" },
  });
  assert.equal(pausedEarly.track, "still");
});

test("ack shows the agent has the feedback, and its note replaces the report line", () => {
  const received = run({
    current: { round: "1" },
    latestSubmissionId: "s2",
    lastReceivedId: "s2",
    lastAcknowledgedId: "s1",
    report: { at: "2026-01-01T00:09:30Z", note: null },
  });
  assert.equal(received.title, "Preparing the next round");
  assert.equal(received.track, "moving");
  assert.deepEqual(received.footer, {
    mark: "active",
    text: "Agent received your feedback",
    at: "2026-01-01T00:09:30Z",
    late: false,
  });
  // A note keeps the time it was sent, so an old one still turns late.
  const noted = run({
    current: { round: "2" },
    ...read,
    report: { at: "2026-01-01T00:04:00Z", note: "Writing the overview page" },
  });
  assert.deepEqual(noted.footer, {
    mark: "active",
    text: "Writing the overview page",
    note: true,
    at: "2026-01-01T00:04:00Z",
    late: true,
  });
});

test("the round status counts pages until the last one and names a silent agent", () => {
  const openRound = {
    pages: [
      { id: "overview", state: "ready" },
      { id: "detail", state: "active" },
      { id: "steps", state: "queued" },
    ],
  };
  const remote = { openRound, updatedAt: "2026-01-01T00:08:00Z" };
  assert.deepEqual(roundModel({ remote, now }), {
    text: "2 of 4 ready",
    late: false,
  });
  assert.deepEqual(
    roundModel({
      remote: { ...remote, updatedAt: "2026-01-01T00:03:00Z" },
      now,
    }),
    { text: "No report for 7 min", late: true },
  );
  assert.deepEqual(roundModel({ remote: { ...remote, paused: {} }, now }), {
    text: "Agent paused",
    late: true,
  });
  const done = {
    pages: openRound.pages.map((item) => ({ ...item, state: "ready" })),
  };
  // An agent report counts even when nothing else changed.
  assert.deepEqual(
    roundModel({
      remote: {
        ...remote,
        updatedAt: "2026-01-01T00:03:00Z",
        report: { at: "2026-01-01T00:08:00Z" },
      },
      now,
    }),
    { text: "2 of 4 ready", late: false },
  );
  assert.equal(roundModel({ remote: { openRound: done }, now }), null);
  assert.equal(roundModel({ remote: {}, now }), null);
});

test("the finished line says when the round finished and how long it took", () => {
  assert.equal(
    finishedLine({
      publishedAt: "2026-01-01T00:08:00Z",
      receivedAt: "2026-01-01T00:02:00Z",
      now,
    }),
    "Finished 2 min ago · took 6 min",
  );
  assert.equal(
    finishedLine({
      publishedAt: "2026-01-01T00:10:00Z",
      receivedAt: "2026-01-01T00:09:50Z",
      now,
    }),
    "Finished just now · took 1 min",
  );
  assert.equal(
    finishedLine({
      publishedAt: "2026-01-01T02:00:00Z",
      receivedAt: "2026-01-01T00:00:00Z",
      now: Date.parse("2026-01-01T05:00:00Z"),
    }),
    "Finished 3 h ago · took 2 h",
  );
  assert.equal(
    finishedLine({
      publishedAt: "2026-01-01T00:08:00Z",
      receivedAt: null,
      now,
    }),
    null,
  );
});

test("the card names the agent that took the session over, and when", () => {
  const at = "2026-01-01T00:09:00Z";
  const clock = [new Date(at).getHours(), new Date(at).getMinutes()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  const model = run({
    current: { round: "1" },
    ...read,
    takeover: { name: "Codex", at },
  });
  assert.equal(model.summary, `Feedback saved · Codex took over at ${clock}`);
  assert.equal(
    run({ current: { round: "1" }, ...read }).summary,
    "Feedback saved",
  );
});

test("the card shows outside a running round what the reviewer must know", () => {
  // Another agent took the session over while the round is with the reviewer.
  const takeover = { name: "Codex", at: "2026-01-01T00:09:00Z" };
  assert.equal(agentNotice({ stage: "ready", takeover }), true);
  // On a round nothing was sent on yet, it says when the pages finished.
  const first = run(
    {
      stage: "ready",
      takeover,
      current: { round: "1", publishedAt: takeover.at },
    },
    {
      submittedRound: null,
      currentSet: {
        pages: currentSet.pages.map((item) => ({ ...item, state: "ready" })),
      },
    },
  );
  assert.equal(first.footer.text, "Finished");
  // Accepting finished work woke no one: the card stays until the agent
  // completes the session, and a failed wake from a finished round is gone.
  const failed = { wake: { last: { ok: false } } };
  assert.equal(agentNotice({ ...failed, stage: "submitted" }), true);
  assert.equal(agentNotice({ ...failed, stage: "complete" }), false);
  assert.equal(agentNotice({ ...failed, stage: "updated" }), false);
});
