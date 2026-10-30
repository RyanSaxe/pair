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

// opened contains a key with the round and the row for each row that the
// reviewer opened. A poll or a rebuild keeps those rows open, and a new
// round starts with every row closed.
const opened = new Set();
const drawn = new Map();
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
  if (mode === "readonly") {
    $("agent-activity").hidden = true;
    $("sent-feedback").hidden = false;
    renderSentFeedback();
    return;
  }
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
  // placeProgress puts the card's threads under the card, or under the
  // finished line while the card is hidden, so they move when the card
  // shows or hides.
  if (wasHidden !== !visible) placeThreads();
  if (visible) drawActivity(running);
}
// running is true while the agent works on a round, and drawActivity then
// shows the elapsed time in the heading.
export function drawActivity(running) {
  // The footer contains only the Message the agent button, so the footer
  // hides whenever that button would.
  $("activity-footer").hidden = !noteEditable();
  $("activity-message-tip").textContent = messageTiming(remote?.holder);
  const model = activityModel({
    remote,
    currentSet: pageSets.get(remote?.current?.round),
    submittedRound,
    inFlight: submissionInFlight,
  });
  const { slots, stopped } = model;
  // The hub sets roundStartedAt at the send, or for round 1 at the pair start
  // that created the session.
  const startedAt = remote?.roundStartedAt;
  $("activity-elapsed").textContent =
    running && startedAt ? since(startedAt) : "";
  $("activity-title").textContent = model.title;
  $("activity-summary").textContent = [model.summary, model.note?.text]
    .filter(Boolean)
    .join(" · ");
  if (model.note) {
    const age = document.createElement("span");
    age.textContent = ago(model.note.at);
    age.classList.toggle("late", model.note.late);
    $("activity-summary").append(" · ", age);
  }
  if (model.reportLine) {
    const line = document.createElement("span");
    line.textContent = model.reportLine.text;
    line.classList.toggle("late", model.reportLine.late);
    $("activity-summary").append(" · ", line);
  }
  const round = remote?.openRound?.round || remote?.current?.round;
  // drawActivity rebuilds the rows when a page's state changes or its first
  // note arrives, and not on a later note, so the list does not redraw on
  // every report.
  const signature = JSON.stringify([
    stopped,
    model.failed,
    model.track,
    model.sweep,
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
    // Each unstarted segment draws its part of one sweep, so index counts
    // only the unstarted segments.
    const unstarted = slots.filter((slot) => slot.state !== "ready").length;
    let index = 0;
    for (const slot of slots) {
      const item = document.createElement("i");
      item.className =
        slot.state === "ready"
          ? "done"
          : slot.state === "active" && !stopped
            ? "now"
            : model.sweep
              ? "sweep"
              : "";
      if (item.className === "sweep") {
        item.style.setProperty("--index", index++);
        item.style.setProperty("--count", unstarted);
      }
      segments.append(item);
      rows.append(...drawRow(slot, stopped, `${round}:page:${slot.id}`));
    }
  }
  // This loop sets the labels in place on every render, so the times
  // advance between rebuilds.
  for (const slot of slots) {
    const row = drawn.get(`${round}:page:${slot.id}`);
    if (!row) continue;
    const label = rowLabel(slot, model);
    row.label.textContent = label.text;
    row.row.classList.toggle("late", Boolean(label.late));
    if (row.note) row.note.textContent = label.note || "";
  }
  const handoff = $("activity-handoff");
  handoff.hidden = !model.failed;
  if (model.failed && !handoff.firstChild)
    handoff.append(handoffLine(remote.handoff));
}
function crumbTrail(crumbs) {
  return crumbs.flatMap((crumb, index) => {
    const node =
      typeof crumb === "string" ? document.createElement("span") : crumb;
    if (typeof crumb === "string") node.textContent = crumb;
    node.classList.add("crumb-name");
    if (!index) return [node];
    const mark = document.createElement("span");
    mark.className = "crumb";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "›";
    return [mark, node];
  });
}
// The hub includes the parent in the built page's session data and in each
// status, so parentCrumbs reads the status first.
function parentCrumbs() {
  const parent = remote?.parent || session.parent;
  if (!parent) return [];
  const link = document.createElement("a");
  link.href = parent.url;
  link.textContent = parent.title;
  return [link, remote?.current?.title || plan.title];
}
function drawHistoryLabel(label, old, past, parent) {
  if (old && session.closed) {
    const name = document.createElement("b");
    name.textContent = plan.title;
    const state = document.createElement("span");
    state.className = "state";
    state.textContent = " is closed";
    return label.replaceChildren(
      ...crumbTrail([...parent.slice(0, 1), name]),
      state,
    );
  }
  if (old || past) {
    const name = document.createElement("b");
    name.className = "place";
    name.textContent = `Round ${old ? plan.round : pastRound}`;
    label.replaceChildren(...crumbTrail([...parent, name]));
    if (past || shownSubmission()) {
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = " · Feedback sent";
      label.append(meta);
    }
    return;
  }
  const here = document.createElement("b");
  here.textContent = parent[1];
  label.replaceChildren(...crumbTrail([parent[0], here]));
}
// A tab click leaves the page on screen, so renderHistory shows the strip
// whenever the page on screen belongs to the earlier round, whichever tab
// is selected.
export function renderHistory() {
  const old = mode === "readonly" || session.closed;
  const past = editable && displayedRound === pastRound;
  const parent = parentCrumbs();
  const strip = $("history-strip");
  strip.hidden = !(old || past || parent.length);
  if (strip.hidden) return;
  const label = $("history-label");
  // renderHistory redraws the line only when it changed, so a pointer on the
  // parent's name keeps its hover state.
  const key = JSON.stringify([
    old,
    past && pastRound,
    plan.round,
    Boolean(shownSubmission()),
    parent.map((crumb) => crumb.textContent ?? crumb),
  ]);
  if (label.dataset.key !== key) {
    label.dataset.key = key;
    drawHistoryLabel(label, old, past, parent);
  }
  const button = $("history-return");
  button.hidden = old ? session.closed : !past || !currentShown();
  button.textContent = "Back to current";
  button.onclick = old
    ? () => location.assign(`${base}/`)
    : () => switchTab("current");
}
// renderRound sets the text only while a round runs, so the last text stays
// visible while the idle status fades out.
export function renderRound() {
  const model = editable ? roundModel({ remote }) : null;
  for (const status of document.querySelectorAll("[data-round-status]")) {
    status.classList.toggle("idle", !model);
    status.classList.toggle("late", Boolean(model?.late));
    if (model) status.lastElementChild.textContent = model.text;
  }
}
