import { since } from "#frame/app/time.mjs";
import { $, recently } from "#frame/app/util.mjs";
import {
  base,
  currentShown,
  editable,
  mode,
  page,
  plan,
  session,
  submittedRound,
  viewKey,
} from "#frame/app/view.mjs";
import { displayedRound, pageIndicator } from "#frame/pages/pages.mjs";
import { handoffLine } from "#frame/pages/renderers.mjs";
import { renderSentFeedback, shownSubmission } from "#frame/review/review.mjs";
import { submissionInFlight } from "#frame/review/send.mjs";
import {
  activityModel,
  agentNotice,
  finishedLine,
  roundModel,
} from "#frame/sync/activity.mjs";
import {
  pageSets,
  pageStatus,
  remote,
  roundFinished,
  roundRunning,
  selectedTab,
  switchTab,
} from "#frame/sync/rounds.mjs";

function slotLabel(state, { stopped, failed }) {
  if (state === "ready") return "Ready";
  if (state !== "active") return "Queued";
  if (!stopped) return "Working";
  return failed ? "Stopped" : "Paused";
}
export function renderActivity() {
  // A read-only round shows what was sent on it, without agent activity.
  if (mode === "readonly") {
    $("agent-activity").hidden = true;
    $("sent-feedback").hidden = false;
    renderSentFeedback();
    return;
  }
  // The agent's progress shows at the top of Current's Agreed, from the send
  // or the round's Agreed to its last page. The left tab shows only what was
  // sent on it.
  const past = selectedTab === "past";
  $("sent-feedback").hidden = !past;
  if (past) renderSentFeedback();
  const onAgreed =
    !past && displayedRound === viewKey() && page.id === "agreed";
  const running = submissionInFlight || roundRunning();
  const visible = onAgreed && (running || agentNotice(remote));
  $("agent-activity").hidden = !visible;
  const finished =
    onAgreed && !visible && roundFinished()
      ? finishedLine({
          publishedAt: remote.current.publishedAt,
          receivedAt: remote.roundStartedAt,
        })
      : null;
  $("finished-line").hidden = !finished;
  if (finished)
    $("finished-line").replaceChildren(
      pageIndicator("complete"),
      document.createTextNode(finished),
    );
  if (!visible) return;
  const model = activityModel({
    remote,
    currentSet: pageSets.get(remote?.current?.round),
    submittedRound,
    inFlight: submissionInFlight,
  });
  const { slots, stopped } = model;
  // The hub records when the agent's round started: the send, the
  // acceptance, the pair start that builds a saved plan, or for round 1 the
  // pair start that created the session.
  const startedAt = remote?.roundStartedAt;
  $("activity-elapsed").textContent =
    running && startedAt ? since(startedAt) : "";
  $("activity-title").textContent = model.title;
  $("activity-summary").textContent = model.summary;
  const signature = JSON.stringify([
    stopped,
    model.failed,
    model.track,
    slots.map(({ id, title, state }) => [id, title, state]),
  ]);
  const segments = $("activity-segments");
  const rows = $("activity-pages");
  if (rows.dataset.signature !== signature) {
    rows.dataset.signature = signature;
    segments.replaceChildren();
    rows.replaceChildren();
    if (model.track) {
      const track = document.createElement("i");
      track.className = `track ${model.track}`;
      segments.append(track);
    }
    for (const slot of slots) {
      const item = document.createElement("i");
      item.className =
        slot.state === "ready"
          ? "done"
          : slot.state === "active" && !stopped
            ? "now"
            : "";
      segments.append(item);
      const row = document.createElement("div");
      row.className = "activity-page";
      const name = document.createElement("span");
      name.textContent = slot.title;
      const label = document.createElement("small");
      label.textContent = slotLabel(slot.state, model);
      const mark = pageIndicator(pageStatus({ status: slot.state }));
      if (stopped) mark.classList.add("stopped");
      row.append(mark, name, label);
      rows.append(row);
    }
  }
  const { footer } = model;
  const report = $("activity-report");
  // The mark is replaced only when its state changes, so polling does not
  // restart its breathing.
  const mark = pageIndicator(
    footer.mark === "stopped" ? "active" : footer.mark,
  );
  if (footer.mark === "stopped") mark.classList.add("stopped");
  const old = report.querySelector(".page-activity");
  if (old?.className !== mark.className)
    old ? old.replaceWith(mark) : report.prepend(mark);
  // The agent's own note stands apart from the time it was sent, and the
  // time stays on one line when the note wraps.
  $("activity-report-text").textContent = footer.at
    ? `${footer.text}${footer.note ? " ·" : ""} ${recently(footer.at).replaceAll(" ", " ")}`
    : footer.text;
  report.classList.toggle("late", Boolean(footer.late));
  // When the wake fails, another agent can take the session over.
  const handoff = $("activity-handoff");
  handoff.hidden = !model.failed;
  if (model.failed && !handoff.firstChild)
    handoff.append(handoffLine(remote.handoff));
}
// Every page of a past round, its Feedback page included, names the
// round. Current never has the strip.
export function renderHistory() {
  const old = mode === "readonly";
  const past = selectedTab === "past";
  const strip = $("history-strip");
  strip.hidden = !(old || past);
  if (strip.hidden) return;
  const label = $("history-label");
  if (old && session.closed) label.textContent = "This plan is closed";
  else {
    const name = document.createElement("b");
    name.textContent = `Round ${plan.round}`;
    label.replaceChildren(name);
    if (past || shownSubmission()) {
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = " · Feedback sent";
      label.append(meta);
    }
  }
  const button = $("history-return");
  button.hidden = old ? session.closed : !currentShown();
  button.textContent = "Back to current";
  button.onclick = old
    ? () => location.assign(`${base}/`)
    : () => switchTab("current");
}
// The Pages heading in the sidebar and in the phone drawer shows the page
// round's status. The text stays while the status fades out.
export function renderRound() {
  const model = editable ? roundModel({ remote }) : null;
  for (const status of document.querySelectorAll("[data-round-status]")) {
    status.classList.toggle("idle", !model);
    status.classList.toggle("late", Boolean(model?.late));
    if (model) status.lastElementChild.textContent = model.text;
  }
}
