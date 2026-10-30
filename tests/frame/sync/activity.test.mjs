import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityModel,
  agentNotice,
  finishedLine,
  messageTiming,
  pendingLabel,
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
  // activityModel compares submission IDs and ignores the report's time, so a
  // report from before s2 does not mark s2 as received.
  const waiting = run({
    current: { round: "1" },
    latestSubmissionId: "s2",
    lastAcknowledgedId: "s1",
    report: { at: "2026-01-01T00:01:00Z", note: null },
  });
  assert.equal(waiting.title, "Waiting for the agent");
  assert.deepEqual(waiting.slots, []);
  assert.equal(waiting.track, "moving");
  assert.equal(waiting.summary, "Feedback saved");
  const unwoken = run({
    current: { round: "1" },
    latestSubmissionId: "s2",
    lastAcknowledgedId: "s1",
    wake: { last: { ok: false } },
  });
  assert.equal(unwoken.track, "still");
  const sending = run({ current: { round: "1" } }, { inFlight: true });
  assert.equal(sending.title, "Sending feedback");
  assert.equal(sending.track, "moving");
  const acknowledged = run({
    current: { round: "1" },
    ...read,
    report: { at: "2026-01-01T00:09:20Z", note: null },
  });
  assert.equal(acknowledged.title, "Preparing the next round");
  assert.deepEqual(acknowledged.slots, []);
  assert.equal(acknowledged.track, "moving");
  assert.equal(acknowledged.summary, "Agent read your feedback");
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
  assert.deepEqual(rowLabel(failed.slots[1], failed, now), {
    text: "Stopped",
  });
  const pausedEarly = run({
    current: { round: "1" },
    ...read,
    paused: { reason: "Waiting" },
  });
  assert.equal(pausedEarly.track, "still");
});

test("a note without --page shows under the card's title before and after Agreed, and turns late at five minutes", () => {
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
  assert.equal(received.note, null);
  const noted = (noteAt, extra = {}) =>
    run({
      current: { round: "1" },
      ...read,
      report: { at: "2026-01-01T00:09:30Z", note: "Reading", noteAt },
      ...extra,
    });
  // activityModel ages a note from noteAt, not from the later report.at, so
  // reports after the note do not reset its age.
  const before = noted("2026-01-01T00:05:01Z");
  assert.deepEqual(before.note, {
    text: "Reading",
    at: "2026-01-01T00:05:01Z",
    late: false,
  });
  assert.equal(noted("2026-01-01T00:05:00Z").note.late, true);
  const after = noted("2026-01-01T00:09:00Z", {
    current: { round: "2" },
    openRound: {
      round: "2",
      pages: [{ id: "loop", title: "Loop", state: "active" }],
    },
  });
  assert.equal(after.note.text, "Reading");
  // For a paused agent, activityModel returns no note, and the summary gives
  // the pause reason.
  const paused = noted("2026-01-01T00:09:00Z", { paused: { reason: "Wait" } });
  assert.equal(paused.note, null);
  // Until the agent receives submission s3, its last note is about earlier
  // feedback, so activityModel returns no note.
  const sent = noted("2026-01-01T00:09:00Z", { latestSubmissionId: "s3" });
  assert.equal(sent.note, null);
});

test("between pages, the unstarted segments sweep and the summary says when the agent last reported, until five minutes pass", () => {
  const between = (report, extra = {}) =>
    run({
      current: { round: "2" },
      ...read,
      openRound: {
        round: "2",
        pages: [
          { id: "loop", title: "Loop", state: "queued" },
          { id: "steps", title: "Steps", state: "queued" },
        ],
      },
      report,
      ...extra,
    });
  const fresh = between({ at: "2026-01-01T00:08:00Z", note: null });
  assert.equal(fresh.summary, "1 of 3 pages ready");
  assert.deepEqual(fresh.reportLine, {
    text: "Last report 2 min ago",
    late: false,
  });
  assert.equal(fresh.sweep, true);
  const quiet = between({ at: "2026-01-01T00:04:00Z", note: null });
  assert.deepEqual(quiet.reportLine, {
    text: "No report for 6 min",
    late: true,
  });
  assert.equal(quiet.sweep, false);
  const noted = between({
    at: "2026-01-01T00:09:00Z",
    note: "Reading the hub",
    noteAt: "2026-01-01T00:09:00Z",
  });
  assert.equal(noted.reportLine, null);
  assert.equal(noted.note.text, "Reading the hub");
  assert.equal(noted.sweep, true);
  const paused = between(
    { at: "2026-01-01T00:09:00Z", note: null },
    { paused: { reason: "Wait" } },
  );
  assert.equal(paused.reportLine, null);
  assert.equal(paused.sweep, false);
  // Once a page is at work, the frame shows the agent's last report in that
  // page's row, so activityModel returns no report line.
  const started = run({
    current: { round: "2" },
    ...read,
    openRound: {
      round: "2",
      pages: [{ id: "loop", title: "Loop", state: "active" }],
    },
    report: { at: "2026-01-01T00:09:00Z", note: null },
  });
  assert.equal(started.reportLine, null);
  assert.equal(started.sweep, false);
});

test("a session with nothing published prepares its first round, with the note in place of where the pages appear", () => {
  const first = (report) =>
    run(
      { current: null, report },
      { currentSet: undefined, submittedRound: null },
    );
  const home = first({ at: "2026-01-01T00:00:00Z", note: null });
  assert.equal(home.title, "Preparing the first round");
  assert.ok(home.summary);
  assert.equal(home.track, "moving");
  assert.deepEqual(home.slots, []);
  const noted = first({
    at: "2026-01-01T00:09:00Z",
    note: "Reading the scroll code",
    noteAt: "2026-01-01T00:09:00Z",
  });
  assert.equal(noted.summary, "");
  assert.equal(noted.note.text, "Reading the scroll code");
});

test("a working page's label and the top of its page count from its note, or from its start, and turn late at five minutes", () => {
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
  assert.deepEqual(pendingLabel(noted, working, at("09:59")), {
    mark: "active",
    text: "Drafting",
    age: "Noted 5 min ago",
    late: false,
  });
  assert.deepEqual(pendingLabel(silent, working, at("10:00")), {
    mark: "active",
    text: "Preparing this page",
    age: "Started 5 min ago",
    late: true,
  });
  assert.deepEqual(pendingLabel(noted, { stopped: true, failed: true }), {
    mark: "active",
    stopped: true,
    text: "Agent stopped",
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
  // agentNotice returns true for a takeover even at stage ready, while the
  // round waits for the reviewer.
  const takeover = { name: "Codex", at: "2026-01-01T00:09:00Z" };
  assert.equal(agentNotice({ stage: "ready", takeover }), true);
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
  // With a failed wake, agentNotice returns true at stage submitted. It returns
  // false once the session is complete, and at stage updated, which the hub
  // sets when the agent publishes a later round's last page.
  const failed = { wake: { last: { ok: false } } };
  assert.equal(agentNotice({ ...failed, stage: "submitted" }), true);
  assert.equal(agentNotice({ ...failed, stage: "complete" }), false);
  assert.equal(agentNotice({ ...failed, stage: "updated" }), false);
});

// The hub sets holder.steerable only at a wake, and a session can have no
// holder.
test("the message tooltip changes only for a holder whose last wake waits for the turn to end", () => {
  const midTurn = messageTiming({ steerable: true });
  assert.equal(messageTiming({}), midTurn);
  assert.equal(messageTiming(null), midTurn);
  assert.notEqual(messageTiming({ steerable: false }), midTurn);
});
