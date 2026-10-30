import { ago, since } from "#frame/app/time.mjs";

export function finishedLine({ publishedAt, receivedAt, now = Date.now() }) {
  const finished = Date.parse(publishedAt);
  if (!Number.isFinite(finished) || !Number.isFinite(Date.parse(receivedAt)))
    return null;
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
  const failed = remote?.wake?.last?.ok === false;
  return { failed, stopped: failed || Boolean(remote?.paused) };
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
  if (slot.state === "ready")
    return { mark: "active", text: "Loading this page" };
  if (slot.state !== "active")
    return { mark: "queued", text: "Waiting to start" };
  if (stopped)
    return {
      mark: "active",
      stopped: true,
      text: failed ? "Agent stopped" : "Agent paused",
    };
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

export function activityModel({
  remote,
  currentSet,
  submittedRound,
  inFlight = false,
  now = Date.now(),
}) {
  // The hub's timestamps can come from an earlier round, so activityModel
  // compares submission IDs. pair ack records that the agent received the
  // submission, and pair read records that it received and read it.
  const latest = remote?.latestSubmissionId;
  const read = Boolean(latest) && remote.lastAcknowledgedId === latest;
  const received =
    read || (Boolean(latest) && remote.lastReceivedId === latest);
  const { failed, stopped } = agentStopped(remote);
  const paused = Boolean(remote?.paused);
  const slots = remote?.openRound
    ? [
        { id: "agreed", title: "Agreed so far", state: "ready" },
        ...remote.openRound.pages,
      ]
    : remote?.current?.round !== submittedRound
      ? currentSet?.pages || []
      : [];
  const ready = slots.filter((item) => item.state === "ready").length;
  const finished = slots.length > 0 && ready === slots.length;
  // Between pages, after Agreed or a page publishes and before the agent
  // starts the next page, no row is at work. The card then shows the agent's
  // reports, with a sweep over the unstarted segments that stops when the
  // reports stop.
  const between =
    slots.length > 0 &&
    !finished &&
    !stopped &&
    !inFlight &&
    !slots.some((item) => item.state === "active");
  const quiet = between ? silence(remote?.report, now) : null;
  const home = Boolean(remote) && !remote.current;
  const title = inFlight
    ? "Sending feedback"
    : stopped
      ? "Agent needs attention"
      : finished
        ? "All pages ready"
        : slots.length
          ? "Pages in progress"
          : home
            ? "Preparing the first round"
            : received
              ? "Preparing the next round"
              : "Waiting for the agent";
  const takeover =
    remote?.takeover &&
    `${remote.takeover.name} took over at ${new Date(remote.takeover.at).toTimeString().slice(0, 5)}`;
  // The report's note shows after the summary while the agent works on a
  // round it has received. The hub clears the note on every report that has
  // none.
  const note =
    inFlight ||
    (latest && !received) ||
    finished ||
    stopped ||
    !remote?.report?.note
      ? null
      : {
          text: remote.report.note,
          at: remote.report.noteAt,
          late: now - Date.parse(remote.report.noteAt) >= LATE,
        };
  const reason = failed
    ? "Could not wake the agent. Send a message in chat."
    : paused
      ? `Agent paused${remote.paused.reason ? `: ${remote.paused.reason}.` : "."} Send a message in chat.`
      : null;
  const summary = inFlight
    ? "Saving your comments"
    : reason ||
      [
        slots.length
          ? `${ready} of ${slots.length} pages ready`
          : home
            ? !note &&
              "The first pages appear here when the agent publishes Agreed."
            : received
              ? read
                ? "Agent read your feedback"
                : "Agent received your feedback"
              : "Feedback saved",
        takeover,
      ]
        .filter(Boolean)
        .join(" · ");
  const reportLine =
    between && !note && remote?.report?.at
      ? quiet
        ? { text: quiet, late: true }
        : { text: `Last report ${ago(remote.report.at, now)}`, late: false }
      : null;
  // The line moves from Send, whether or not the agent has received the
  // feedback, because a slow wake must not look like a frozen page. It stops
  // only when the card says that the agent stopped.
  const track = slots.length
    ? null
    : inFlight || ((latest || home) && !stopped)
      ? "moving"
      : "still";
  const sweep = between && !quiet;
  return {
    slots,
    ready,
    failed,
    stopped,
    title,
    summary,
    note,
    reportLine,
    track,
    sweep,
  };
}

// The frame shows the progress card outside a round that a send started
// when agentNotice returns true.
export function agentNotice(remote) {
  if (!remote || remote.stage === "complete") return false;
  return (
    Boolean(remote.takeover) ||
    (remote.wake?.last?.ok === false &&
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
  if (remote.paused) return { text: "Agent paused", late: true };
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
