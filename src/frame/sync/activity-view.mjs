import { ago, since } from "#frame/app/time.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  base,
  currentShown,
  editable,
  mode,
  noteEditable,
  page,
  pastRound,
  plan,
  session,
  submittedRound,
  viewKey,
} from "#frame/app/view.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import { displayedRound, pageIndicator } from "#frame/pages/pages.mjs";
import { handoffLine } from "#frame/pages/renderers.mjs";
import { renderSentFeedback, shownSubmission } from "#frame/review/review.mjs";
import { submissionInFlight } from "#frame/review/send.mjs";
import {
  activityModel,
  agentNotice,
  finishedLine,
  messageTiming,
  roundModel,
  rowLabel,
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

// The rows the reviewer opened, by round and row, so a poll or a rebuild
// keeps them open and a new round starts with every row closed.
const opened = new Set();
// The label and note of each drawn row, which every render updates in place.
const drawn = new Map();
// A working row with a note is a button that opens the note under it. Every
// other row is a line of text, as before.
function drawRow(slot, stopped, key) {
  const noted = slot.state === "active" && !stopped && Boolean(slot.note);
  const row = document.createElement(noted ? "button" : "div");
  row.className = "activity-page";
  const mark = pageIndicator(pageStatus({ status: slot.state }));
  if (stopped) mark.classList.add("stopped");
  const name = document.createElement("span");
  name.textContent = slot.title;
  const label = document.createElement("small");
  row.append(mark, name, label);
  if (!noted) {
    drawn.set(key, { row, label });
    return [row];
  }
  row.type = "button";
  const note = document.createElement("div");
  note.className = "activity-note";
  const show = (open) => {
    row.setAttribute("aria-expanded", String(open));
    note.hidden = !open;
  };
  show(opened.has(key));
  row.onclick = () => {
    if (opened.has(key)) opened.delete(key);
    else opened.add(key);
    show(opened.has(key));
  };
  drawn.set(key, { row, label, note });
  return [row, note];
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
  const wasHidden = $("agent-activity").hidden;
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
  // A thread started from the card sits under it, or under the finished line
  // once the card hides, so it moves when the card shows or hides.
  if (wasHidden !== !visible) placeThreads();
  if (visible) drawActivity(running);
}
// The progress card's contents. running says the agent works on a round, so
// the heading shows how long it has taken.
export function drawActivity(running) {
  // The footer contains only Message the agent, so it goes with the button.
  $("activity-footer").hidden = !noteEditable();
  $("activity-message-tip").textContent = messageTiming(remote?.holder);
  const model = activityModel({
    remote,
    currentSet: pageSets.get(remote?.current?.round),
    submittedRound,
    inFlight: submissionInFlight,
  });
  const { slots, stopped } = model;
  // The hub records when the agent's round started: the send, or for round 1
  // the pair start that created the session.
  const startedAt = remote?.roundStartedAt;
  $("activity-elapsed").textContent =
    running && startedAt ? since(startedAt) : "";
  $("activity-title").textContent = model.title;
  // The summary, then the round's note and its age, which turns late as a
  // row's label does.
  $("activity-summary").textContent = [model.summary, model.note?.text]
    .filter(Boolean)
    .join(" · ");
  if (model.note) {
    const age = document.createElement("span");
    age.textContent = ago(model.note.at);
    age.classList.toggle("late", model.note.late);
    $("activity-summary").append(" · ", age);
  }
  const round = remote?.openRound?.round || remote?.current?.round;
  // A row rebuilds when a page's state changes or its first note arrives,
  // never on a later note, so the list does not redraw on every report.
  const signature = JSON.stringify([
    stopped,
    model.failed,
    model.track,
    round,
    slots.map(({ id, title, state, note }) => [
      id,
      title,
      state,
      Boolean(note),
    ]),
  ]);
  const segments = $("activity-segments");
  const rows = $("activity-pages");
  if (rows.dataset.signature !== signature) {
    rows.dataset.signature = signature;
    segments.replaceChildren();
    rows.replaceChildren();
    drawn.clear();
    for (const key of opened)
      if (!key.startsWith(`${round}:`)) opened.delete(key);
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
      rows.append(...drawRow(slot, stopped, `${round}:page:${slot.id}`));
    }
  }
  // Each render sets the labels in place, so the times advance between
  // rebuilds.
  for (const slot of slots) {
    const row = drawn.get(`${round}:page:${slot.id}`);
    if (!row) continue;
    const label = rowLabel(slot, model);
    row.label.textContent = label.text;
    row.row.classList.toggle("late", Boolean(label.late));
    if (row.note) row.note.textContent = label.note || "";
  }
  // When the wake fails, another agent can take the session over.
  const handoff = $("activity-handoff");
  handoff.hidden = !model.failed;
  if (model.failed && !handoff.firstChild)
    handoff.append(handoffLine(remote.handoff));
}
// Every page of a past round, its Feedback page included, names the
// round. Current never has the strip. A tab click leaves the page on screen,
// so the strip shows whenever that page belongs to the earlier round,
// whichever tab is chosen.
export function renderHistory() {
  const old = mode === "readonly";
  const past = editable && displayedRound === pastRound;
  const strip = $("history-strip");
  strip.hidden = !(old || past);
  if (strip.hidden) return;
  const label = $("history-label");
  if (old && session.closed) label.textContent = "This plan is closed";
  else {
    const name = document.createElement("b");
    name.textContent = `Round ${old ? plan.round : pastRound}`;
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
