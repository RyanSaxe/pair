import { ago, since } from "#frame/app/time.mjs";
import { isClosed, lifecycle } from "#shared/lifecycle.mjs";
import { deliveryState, wakeAccepts } from "#shared/wake-state.mjs";

export function finishedLine({ publishedAt, receivedAt, now = Date.now() }) {
  const finished = Date.parse(publishedAt);
  if (!Number.isFinite(finished) || !Number.isFinite(Date.parse(receivedAt))) {
    return null;
  }
  return `Finished ${ago(publishedAt, now)} · took ${since(receivedAt, finished)}`;
}

// The frame marks a row or the round's note late after five minutes with no
// report on it.
const LATE = 300000;

// roundModel and activityModel both call silence, so the Pages heading and
// the progress card show the same words.
function silence(report, now) {
  const ms = now - Date.parse(report?.at);
  return ms >= LATE ? `No report for ${Math.floor(ms / 60000)} min` : null;
}

export function agentStopped(remote) {
  const failed = wakeAccepts(remote, "alert");
  return { failed, stopped: failed || lifecycle(remote) === "paused" };
}

function lastReport(slot, now) {
  const at = slot.note?.at || slot.startedAt;
  return at ? { at, late: now - Date.parse(at) >= LATE } : null;
}

export function rowLabel(slot, { stopped, failed }, now = Date.now()) {
  if (slot.state === "ready") return { text: "Ready" };
  if (slot.state !== "active") return { text: "Queued" };
  if (stopped) return { text: failed ? "Stopped" : "Paused" };
  const report = lastReport(slot, now);
  if (!report) return { text: "Working" };
  return {
    text: ago(report.at, now),
    late: report.late,
    note: slot.note?.text || null,
  };
}

// While the agent is stopped, its last note no longer says what it is doing,
// so pendingLabel shows that the agent stopped instead.
export function pendingLabel(slot, { stopped, failed }, now = Date.now()) {
  if (slot.state === "ready") {
    return { mark: "active", text: "Loading this page" };
  }
  if (slot.state !== "active") {
    return { mark: "queued", text: "Waiting to start" };
  }
  if (stopped) {
    return {
      mark: "active",
      stopped: true,
      text: failed ? "Agent stopped" : "Agent paused",
    };
  }
  const report = lastReport(slot, now);
  return {
    mark: "active",
    text: slot.note?.text || "Preparing this page",
    ...(report && {
      age: `${slot.note ? "Noted" : "Started"} ${ago(report.at, now)}`,
      late: report.late,
    }),
  };
}

function activitySlots(remote, currentSet, submittedRound) {
  if (remote?.openRound) {
    return [
      { id: "agreed", title: "Agreed so far", state: "ready" },
      ...remote.openRound.pages,
    ];
  }
  if (remote?.current?.round === submittedRound) return [];
  return currentSet?.pages || [];
}

function activityTitle({
  inFlight,
  stopped,
  finished,
  hasSlots,
  home,
  received,
}) {
  if (inFlight) return "Sending";
  if (stopped) return "Agent needs attention";
  if (finished) return "All pages ready";
  if (hasSlots) return "Pages in progress";
  if (home) return "Preparing the first round";
  return received ? "Preparing the next round" : "Waiting for the agent";
}

function activityNote({
  inFlight,
  latest,
  received,
  finished,
  stopped,
  remote,
  now,
}) {
  if (inFlight || (latest && !received) || finished || stopped) return null;
  if (!remote?.report?.note) return null;
  return {
    text: remote.report.note,
    at: remote.report.noteAt,
    late: now - Date.parse(remote.report.noteAt) >= LATE,
  };
}

function stoppedReason(failed, paused, remote) {
  if (failed) return "Could not wake the agent. Send a message in chat.";
  if (!paused) return null;
  const suffix = remote.paused.reason ? `: ${remote.paused.reason}.` : ".";
  return `Agent paused${suffix} Send a message in chat.`;
}

function baseSummary({ slots, ready, home, note, received, read }) {
  if (slots.length) return `${ready} of ${slots.length} pages ready`;
  if (home) {
    return (
      !note && "The first pages appear here when the agent publishes Agreed."
    );
  }
  if (!received) return "Saved for the agent";
  return read ? "Agent read what you sent" : "Agent received what you sent";
}

function activitySummary(context) {
  if (context.inFlight) return "Saving what you sent";
  const reason = stoppedReason(context.failed, context.paused, context.remote);
  if (reason) return reason;
  const takeover =
    context.remote?.takeover &&
    `${context.remote.takeover.name} took over at ${new Date(context.remote.takeover.at).toTimeString().slice(0, 5)}`;
  return [baseSummary(context), takeover].filter(Boolean).join(" · ");
}

function activityReportLine({ between, note, remote, quiet, now }) {
  if (!between || note || !remote?.report?.at) return null;
  if (quiet) return { text: quiet, late: true };
  return { text: `Last report ${ago(remote.report.at, now)}`, late: false };
}

function activityTrack({ hasSlots, inFlight, latest, home, stopped }) {
  if (hasSlots) return null;
  // The line moves from Send, whether or not the agent has received the
  // feedback, because a slow wake must not look like a frozen page. It stops
  // only when the card says that the agent stopped.
  return inFlight || ((latest || home) && !stopped) ? "moving" : "still";
}

function isBetweenPages({ slots, finished, stopped, inFlight }) {
  return (
    slots.length > 0 &&
    !finished &&
    !stopped &&
    !inFlight &&
    !slots.some((item) => item.state === "active")
  );
}

export function activityModel({
  remote,
  currentSet,
  submittedRound,
  inFlight = false,
  now = Date.now(),
}) {
  const latest = remote?.latestSubmissionId;
  const delivery = deliveryState(remote);
  const read = delivery === "read";
  const received = read || delivery === "received";
  const { failed, stopped } = agentStopped(remote);
  const paused = lifecycle(remote) === "paused";
  const slots = activitySlots(remote, currentSet, submittedRound);
  const ready = slots.filter((item) => item.state === "ready").length;
  const finished = slots.length > 0 && ready === slots.length;
  // Between pages, after Agreed or a page publishes and before the agent
  // starts the next page, no row is at work. The card then shows the agent's
  // reports, with a sweep over the unstarted segments that stops when the
  // reports stop.
  const between = isBetweenPages({ slots, finished, stopped, inFlight });
  const quiet = between ? silence(remote?.report, now) : null;
  const home = Boolean(remote) && !remote.current;
  const note = activityNote({
    inFlight,
    latest,
    received,
    finished,
    stopped,
    remote,
    now,
  });
  return {
    slots,
    ready,
    failed,
    stopped,
    title: activityTitle({
      inFlight,
      stopped,
      finished,
      hasSlots: Boolean(slots.length),
      home,
      received,
    }),
    summary: activitySummary({
      inFlight,
      failed,
      paused,
      remote,
      slots,
      ready,
      home,
      note,
      received,
      read,
    }),
    note,
    reportLine: activityReportLine({ between, note, remote, quiet, now }),
    track: activityTrack({
      hasSlots: Boolean(slots.length),
      inFlight,
      latest,
      home,
      stopped,
    }),
    sweep: between && !quiet,
  };
}

// The frame shows the progress card outside a round that a send started
// when agentNotice returns true.
export function agentNotice(remote) {
  if (!remote || isClosed(remote)) return false;
  return (
    Boolean(remote.takeover) ||
    (wakeAccepts(remote, "alert") &&
      ["submitted", "working"].includes(remote.stage))
  );
}

// roundModel gives the Pages heading a status while a round's pages are
// arriving, so the dimmed page names always appear with a sign of the
// agent. remote.openRound exists only until the last page publishes.
export function roundModel({ remote, now = Date.now() }) {
  const round = remote?.openRound;
  if (!round) return null;
  const total = round.pages.length + 1;
  const ready = 1 + round.pages.filter((item) => item.state === "ready").length;
  if (ready === total) return null;
  if (lifecycle(remote) === "paused") {
    return { text: "Agent paused", late: true };
  }
  const quiet = silence(remote.report, now);
  if (quiet) return { text: quiet, late: true };
  return { text: `${ready} of ${total} ready`, late: false };
}

// The hub sets holder.steerable on each wake. It is false only after a wake
// on a path where the agent reads the line after its turn ends: codex queue
// for a thread that Codex's app-server daemon does not run, Copilot's
// enqueue, or a Codex subagent's parent, which passes the line on. On every
// other path the agent CLI reads a message between the steps of a turn. A
// holder that has had no wake yet gets the between-steps text too.
export function messageTiming(holder) {
  return holder?.steerable === false
    ? "The agent reads messages only between its turns. While it writes a round, it reads this one after it publishes the round's last page."
    : "The agent reads messages between its steps, so a reply can take a minute while it is busy.";
}
