import { ago, since } from "#frame/app/time.mjs";

// Once the last page of a round that a send started is published, Agreed
// keeps one line saying when the round finished and how long it took.
export function finishedLine({ publishedAt, receivedAt, now = Date.now() }) {
  const finished = Date.parse(publishedAt);
  if (!Number.isFinite(finished) || !Number.isFinite(Date.parse(receivedAt)))
    return null;
  return `Finished ${ago(publishedAt, now)} · took ${since(receivedAt, finished)}`;
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
  // The agent's last report, and the note it gave with ack.
  const reportAt = remote?.report?.at;
  const note = remote?.report?.note;
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
  const summary = inFlight
    ? "Saving your comments"
    : (slots.length
        ? `${ready} of ${slots.length} pages ready`
        : "Feedback saved") + takeover;
  const late = (at) => Boolean(at) && now - Date.parse(at) >= 300000;
  // The footer always has a mark and a line, so the card keeps its shape
  // from the send to the last page. The frame shows `at` as a relative time.
  let footer;
  if (inFlight) footer = { mark: "active", text: "Saving your feedback" };
  else if (failed)
    footer = {
      mark: "stopped",
      text: "Could not wake the agent. Send a message in chat.",
      late: true,
    };
  else if (paused)
    footer = {
      mark: "stopped",
      text: `Agent paused${remote.paused.reason ? `: ${remote.paused.reason}.` : "."} Send a message in chat.`,
      late: true,
    };
  // With nothing sent yet, such as a takeover on the first round, there is
  // no send for the agent to report on.
  else if (latest && !received)
    footer = { mark: "queued", text: "No agent report yet" };
  else if (finished)
    footer = {
      mark: "complete",
      text: "Finished",
      at: remote.current?.publishedAt,
    };
  else if (note)
    footer = {
      mark: "active",
      text: note,
      note: true,
      at: reportAt,
      late: late(reportAt),
    };
  else if (!slots.length)
    footer = {
      mark: "active",
      text: read ? "Agent read your feedback" : "Agent received your feedback",
      at: reportAt,
      late: late(reportAt),
    };
  else
    footer = {
      mark: "active",
      text: "Last report",
      at: reportAt,
      late: late(reportAt),
    };
  // Until the page list exists, the bar is one track that moves while the
  // agent works on the feedback.
  const track = slots.length
    ? null
    : inFlight || (received && !stopped)
      ? "moving"
      : "still";
  return { slots, ready, failed, stopped, title, summary, footer, track };
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
