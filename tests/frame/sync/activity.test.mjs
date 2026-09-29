import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityModel,
  agentNotice,
  finishedLine,
  roundModel,
  rowLabel,
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
  // A report on an earlier round does not count for this one.
  const waiting = run({
    current: { round: "1" },
    latestSubmissionId: "s2",
    lastAcknowledgedId: "s1",
    report: { at: "2026-01-01T00:01:00Z", note: null },
  });
  assert.equal(waiting.title, "Waiting for the agent");
  assert.deepEqual(waiting.slots, []);
  assert.equal(waiting.track, "still");
  assert.equal(waiting.summary, "Feedback saved");
  assert.equal(waiting.background, null);
  const sending = run({ current: { round: "1" } }, { inFlight: true });
  assert.equal(sending.title, "Sending feedback");
  assert.equal(sending.track, "moving");
  assert.equal(sending.background, null);
  const acknowledged = run({
    current: { round: "1" },
    ...read,
    report: { at: "2026-01-01T00:09:20Z", note: null },
  });
  assert.equal(acknowledged.title, "Preparing the next round");
  assert.deepEqual(acknowledged.slots, []);
  assert.equal(acknowledged.track, "moving");
  assert.equal(acknowledged.summary, "Agent read your feedback");
  assert.equal(acknowledged.background.title, "Background");
  assert.equal(acknowledged.background.note, null);
});

test("published page names keep their order while readiness changes", () => {
  const model = run({
    current: { round: "2" },
    ...read,
    report: { at: "2026-01-01T00:09:00Z", note: null },
  });
  assert.equal(model.title, "Pages in progress");
  assert.equal(model.summary, "1 of 3 pages ready");
  assert.equal(model.track, null);
  assert.deepEqual(
    model.slots.map((item) => item.id),
    ["agreed", "overview", "detail"],
  );
  assert.equal(model.background.note, null);
  const finished = run(
    {
      current: { round: "2", publishedAt: "2026-01-01T00:08:00Z" },
      ...read,
      report: { at: "2026-01-01T00:00:00Z", note: null },
    },
    {
      currentSet: {
        pages: currentSet.pages.map((item) => ({ ...item, state: "ready" })),
      },
    },
  );
  assert.equal(finished.title, "All pages ready");
  assert.equal(finished.background, null);
});

test("pause or a failed wake names the reason in the summary, and the rows stop", () => {
  const remote = {
    current: { round: "2" },
    ...read,
    report: { at: "2026-01-01T00:05:00Z", note: null },
  };
  const paused = run({ ...remote, paused: { reason: "Waiting for input" } });
  assert.equal(paused.stopped, true);
  assert.equal(
    paused.summary,
    "Agent paused: Waiting for input. Send a message in chat.",
  );
  assert.deepEqual(rowLabel(paused.slots[1], paused, now), { text: "Paused" });
  const failed = run({
    ...remote,
    wake: { last: { ok: false } },
    paused: { reason: "Waiting" },
  });
  assert.equal(
    failed.summary,
    "Could not wake the agent. Send a message in chat.",
  );
  assert.deepEqual(rowLabel(failed.background, failed, now), {
    text: "Stopped",
  });
  const pausedEarly = run({
    current: { round: "1" },
    ...read,
    paused: { reason: "Waiting" },
  });
  assert.equal(pausedEarly.track, "still");
});

test("a note without --page goes on the Background row, which counts from it", () => {
  const received = run({
    current: { round: "1" },
    latestSubmissionId: "s2",
    lastReceivedId: "s2",
    lastAcknowledgedId: "s1",
    report: { at: "2026-01-01T00:09:30Z", note: null },
  });
  assert.equal(received.title, "Preparing the next round");
  assert.equal(received.track, "moving");
  assert.equal(received.summary, "Agent received your feedback");
  const background = (report, extra = {}) => {
    const model = run({ current: { round: "2" }, ...read, report, ...extra });
    return rowLabel(model.background, model, now);
  };
  // A note keeps the time it was sent, so an old one still turns late, and
  // page notes since then move only report.at.
  assert.deepEqual(
    background({
      at: "2026-01-01T00:09:30Z",
      note: "Writing the overview page",
      noteAt: "2026-01-01T00:04:00Z",
    }),
    { text: "6 min ago", late: true, note: "Writing the overview page" },
  );
  // Before any note in this round, the row counts from the round's start,
  // and a note from an earlier round does not count.
  const start = { roundStartedAt: "2026-01-01T00:08:00Z" };
  const quiet = { text: "2 min ago", late: false, note: null };
  assert.deepEqual(
    background({ at: "2026-01-01T00:09:00Z", note: null }, start),
    quiet,
  );
  assert.deepEqual(
    background(
      {
        at: "2026-01-01T00:09:00Z",
        note: null,
        noteAt: "2026-01-01T00:01:00Z",
      },
      start,
    ),
    quiet,
  );
  // Once Agreed publishes, a note from planning the round makes no
  // Background row, and a note sent after Agreed does.
  const afterAgreed = (noteAt) =>
    run({
      current: { round: "2" },
      ...read,
      report: { at: "2026-01-01T00:09:00Z", note: "Planning", noteAt },
      openRound: {
        round: "2",
        agreedAt: "2026-01-01T00:05:00Z",
        pages: [{ id: "loop", title: "Loop", state: "active" }],
      },
    }).background;
  assert.equal(afterAgreed("2026-01-01T00:04:00Z"), null);
  assert.equal(afterAgreed("2026-01-01T00:06:00Z").note.text, "Planning");
});

test("a working page's label counts from its note, or from its start, and turns late at five minutes", () => {
  const working = { stopped: false, failed: false };
  const at = (clock) => Date.parse(`2026-01-01T00:${clock}Z`);
  const noted = {
    state: "active",
    startedAt: "2026-01-01T00:00:00Z",
    note: { text: "Drafting", at: "2026-01-01T00:05:00Z" },
  };
  assert.deepEqual(rowLabel(noted, working, at("09:59")), {
    text: "5 min ago",
    late: false,
    note: "Drafting",
  });
  assert.equal(rowLabel(noted, working, at("10:00")).late, true);
  const silent = { state: "active", startedAt: "2026-01-01T00:05:00Z" };
  assert.deepEqual(rowLabel(silent, working, at("09:59")), {
    text: "5 min ago",
    late: false,
    note: null,
  });
  assert.equal(rowLabel(silent, working, at("10:00")).late, true);
  assert.deepEqual(rowLabel({ state: "active" }, working), { text: "Working" });
  assert.deepEqual(rowLabel({ state: "ready" }, working), { text: "Ready" });
  assert.deepEqual(rowLabel({ state: "queued" }, working), { text: "Queued" });
});

test("the round status counts pages until the last one and names a silent agent", () => {
  const openRound = {
    pages: [
      { id: "overview", state: "ready" },
      { id: "detail", state: "active" },
      { id: "steps", state: "queued" },
    ],
  };
  const remote = { openRound, report: { at: "2026-01-01T00:08:00Z" } };
  assert.deepEqual(roundModel({ remote, now }), {
    text: "2 of 4 ready",
    late: false,
  });
  assert.deepEqual(
    roundModel({
      remote: { ...remote, report: { at: "2026-01-01T00:03:00Z" } },
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
  assert.equal(
    model.summary,
    `Agent read your feedback · Codex took over at ${clock}`,
  );
  assert.equal(
    run({ current: { round: "1" }, ...read }).summary,
    "Agent read your feedback",
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
  assert.equal(first.title, "All pages ready");
  assert.equal(first.background, null);
  // Accepting finished work woke no one: the card stays until the agent
  // completes the session, and a failed wake from a finished round is gone.
  const failed = { wake: { last: { ok: false } } };
  assert.equal(agentNotice({ ...failed, stage: "submitted" }), true);
  assert.equal(agentNotice({ ...failed, stage: "complete" }), false);
  assert.equal(agentNotice({ ...failed, stage: "updated" }), false);
});
