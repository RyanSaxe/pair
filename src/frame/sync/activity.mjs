import { ago, since } from "#frame/app/time.mjs";

// Once the last page of a round that a send started is published, Agreed
// keeps one line saying when the round finished and how long it took.
export function finishedLine({ publishedAt, receivedAt, now = Date.now() }) {
  const finished = Date.parse(publishedAt);
  if (!Number.isFinite(finished) || !Number.isFinite(Date.parse(receivedAt)))
    return null;
  return `Finished ${ago(publishedAt, now)} · took ${since(receivedAt, finished)}`;
}

// A row turns late when five minutes pass without a report on it.
const LATE = 300000;
const later = (a, b) =>
  !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;

// The label on a row of the progress card: a page's state, or for a page at
// work, how long ago it last reported. A page with no note yet counts from
// when it started.
export function rowLabel(slot, { stopped, failed }, now = Date.now()) {
  if (slot.state === "ready") return { text: "Ready" };
  if (slot.state !== "active") return { text: "Queued" };
  if (stopped) return { text: failed ? "Stopped" : "Paused" };
  const at = slot.note?.at || slot.startedAt;
  if (!at) return { text: "Working" };
  return {
    text: ago(at, now),
    late: now - Date.parse(at) >= LATE,
    note: slot.note?.text || null,
  };
}

export function activityModel({
  remote,
  currentSet,
  submittedRound,
  inFlight = false,
  now = Date.now(),
}) {
  // Timestamps survive from earlier rounds, so only the ids say whether the
  // agent has this submission: ack receives it, and read receives and reads it.
  const latest = remote?.latestSubmissionId;
  const read = Boolean(latest) && remote.lastAcknowledgedId === latest;
  const received =
    read || (Boolean(latest) && remote.lastReceivedId === latest);
  const failed = remote?.wake?.last?.ok === false;
  const paused = Boolean(remote?.paused);
  const stopped = failed || paused;
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
  const title = inFlight
    ? "Sending feedback"
    : stopped
      ? "Agent needs attention"
      : finished
        ? "All pages ready"
        : slots.length
          ? "Pages in progress"
          : received
            ? "Preparing the next round"
            : "Waiting for the agent";
  // An agent that took the session over since the reviewer's last send is
  // named with the time it took over.
  const takeover = remote?.takeover
    ? ` · ${remote.takeover.name} took over at ${new Date(remote.takeover.at).toTimeString().slice(0, 5)}`
    : "";
  // With no note in the footer, the summary line names why the agent
  // stopped, and before the page list exists, that it has the feedback.
  const reason = failed
    ? "Could not wake the agent. Send a message in chat."
    : paused
      ? `Agent paused${remote.paused.reason ? `: ${remote.paused.reason}.` : "."} Send a message in chat.`
      : null;
  const summary = inFlight
    ? "Saving your comments"
    : reason ||
      (slots.length
        ? `${ready} of ${slots.length} pages ready`
        : received
          ? read
            ? "Agent read your feedback"
            : "Agent received your feedback"
          : "Feedback saved") + takeover;
  // The Background row takes the notes sent without --page. It counts from
  // the last of them, or from the start of the round before any, and it
  // shows only while the agent is at work on a round it has received. Once
  // Agreed publishes it shows only a note sent after that, because a note
  // from planning the round is not background work.
  const agreedAt = remote?.openRound?.agreedAt;
  const noteAfterAgreed =
    !agreedAt ||
    (remote?.report?.noteAt &&
      Date.parse(remote.report.noteAt) > Date.parse(agreedAt));
  const background =
    inFlight || (latest && !received) || finished || !remote || !noteAfterAgreed
      ? null
      : {
          id: "background",
          title: "Background",
          state: "active",
          startedAt: later(remote.report?.noteAt, remote.roundStartedAt),
          note: remote.report?.note
            ? { text: remote.report.note, at: remote.report.noteAt }
            : null,
        };
  // Until the page list exists, the bar is one track that moves while the
  // agent works on the feedback.
  const track = slots.length
    ? null
    : inFlight || (received && !stopped)
      ? "moving"
      : "still";
  return { slots, ready, failed, stopped, title, summary, background, track };
}

// Outside a round that a send started, the card still tells the reviewer
// about the agent: that another agent took the session over since their
// last send, or that the wake for an acceptance failed.
export function agentNotice(remote) {
  if (!remote || remote.stage === "complete") return false;
  return (
    Boolean(remote.takeover) ||
    (remote.wake?.last?.ok === false &&
      ["submitted", "working"].includes(remote.stage))
  );
}

// While a round's pages are still arriving, the Pages heading says so, so
// dim names never sit there without a sign of the agent. The page round
// exists only until the last page publishes.
export function roundModel({ remote, now = Date.now() }) {
  const round = remote?.openRound;
  if (!round) return null;
  const total = round.pages.length + 1;
  const ready = 1 + round.pages.filter((item) => item.state === "ready").length;
  if (ready === total) return null;
  if (remote.paused) return { text: "Agent paused", late: true };
  const minutes = Math.floor((now - Date.parse(remote.report?.at)) / 60000);
  if (minutes >= 5) return { text: `No report for ${minutes} min`, late: true };
  return { text: `${ready} of ${total} ready`, late: false };
}
