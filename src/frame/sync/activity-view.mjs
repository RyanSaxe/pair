import { callHook } from "#frame/app/hooks.mjs";
import {
  connected,
  displayedRound,
  pageSets,
  pageStatus,
  remote,
  selectedTab,
  submissionInFlight,
} from "#frame/app/state.mjs";
import { ago, since } from "#frame/app/time.mjs";
import { pageIndicator } from "#frame/app/ui.mjs";
import { $, copyText } from "#frame/app/util.mjs";
import {
  base,
  currentShown,
  editable,
  mode,
  page,
  pastRound,
  plan,
  session,
  submittedRound,
  viewKey,
  waiting,
} from "#frame/app/view.mjs";
import { placeMarks } from "#frame/notes/notes.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import { moveFading, pictureHeld } from "#frame/pages/progress.mjs";
import { handoffLine } from "#frame/pages/renderers.mjs";
import { noteEditable } from "#frame/review/send-state.mjs";
import {
  activityModel,
  agentNotice,
  finishedLine,
  messageTiming,
  roundModel,
  rowLabel,
} from "#frame/sync/activity.mjs";

// A round counts as running from the reader's send, and while any round's
// pages are still being published. That includes round 1 and a build from
// the handoff line.
const roundRunning = () =>
  (Boolean(submittedRound) && waiting()) || Boolean(remote?.openRound);

const roundFinished = () =>
  Boolean(submittedRound) &&
  Boolean(remote?.current) &&
  !remote.openRound &&
  remote.current.round !== submittedRound &&
  remote.latestSubmissionRound === submittedRound;

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
  row.addEventListener("click", () => {
    if (opened.has(key)) opened.delete(key);
    else opened.add(key);
    show(opened.has(key));
  });
  drawn.set(key, { row, label, note });
  return [row, note];
}

function updateFinishedLine(onAgreed, visible) {
  const finished =
    onAgreed && !visible && roundFinished()
      ? finishedLine({
          publishedAt: remote.current.publishedAt,
          receivedAt: remote.roundStartedAt,
        })
      : null;
  $("finished-line").hidden = !finished;
  if (finished) {
    $("finished-line").replaceChildren(
      pageIndicator("complete"),
      document.createTextNode(finished),
    );
  }
}

export function renderActivity() {
  if (mode === "readonly") {
    $("agent-activity").hidden = true;
    $("sent-feedback").hidden = false;
    callHook("renderSentFeedback");
    return;
  }
  const past = selectedTab === "past";
  $("sent-feedback").hidden = !past;
  if (past) callHook("renderSentFeedback");
  const onAgreed =
    !past && displayedRound === viewKey() && page.id === "agreed";
  const running = submissionInFlight || roundRunning();
  const visible = onAgreed && (running || agentNotice(remote));
  const wasHidden = $("agent-activity").hidden;
  $("agent-activity").hidden = !visible;
  updateFinishedLine(onAgreed, visible);
  // The page's blocks move under the note bars when the card hides and
  // placeProgress collapses its threads, so renderActivity places the marks.
  if (wasHidden !== !visible) {
    placeThreads();
    placeMarks();
  }
  if (visible) drawActivity(running);
}

function segmentClass(slot, stopped, sweep) {
  if (slot.state === "ready") return "done";
  if (slot.state === "active" && !stopped) return "now";
  return sweep ? "sweep" : "";
}

function drawActivitySummary(model, running) {
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
}

function rebuildActivityRows(round, model) {
  const { slots, stopped } = model;
  const segments = $("activity-segments");
  const rows = $("activity-pages");
  segments.replaceChildren();
  rows.replaceChildren();
  drawn.clear();
  for (const key of opened) {
    if (!key.startsWith(`${round}:`)) opened.delete(key);
  }
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
    item.className = segmentClass(slot, stopped, model.sweep);
    if (item.className === "sweep") {
      item.style.setProperty("--index", index++);
      item.style.setProperty("--count", unstarted);
    }
    segments.append(item);
    rows.append(...drawRow(slot, stopped, `${round}:page:${slot.id}`));
  }
}

function updateActivityRowLabels(round, model) {
  // This loop sets the labels in place on every render, so the times
  // advance between rebuilds.
  for (const slot of model.slots) {
    const row = drawn.get(`${round}:page:${slot.id}`);
    if (!row) continue;
    const label = rowLabel(slot, model);
    row.label.textContent = label.text;
    row.row.classList.toggle("late", Boolean(label.late));
    if (row.note) row.note.textContent = label.note || "";
  }
}

function activitySignature(round, model) {
  return JSON.stringify([
    model.stopped,
    model.failed,
    model.track,
    model.sweep,
    round,
    model.slots.map(({ id, title, state, note }) => [
      id,
      title,
      state,
      Boolean(note),
    ]),
  ]);
}

function syncActivityHandoff(failed) {
  const handoff = $("activity-handoff");
  handoff.hidden = !failed;
  if (failed && !handoff.firstChild) {
    handoff.append(handoffLine(remote.handoff));
  }
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
  drawActivitySummary(model, running);
  const round = remote?.openRound?.round || remote?.current?.round;
  // drawActivity rebuilds the rows when a page's state changes or its first
  // note arrives, and not on a later note, so the list does not redraw on
  // every report.
  const signature = activitySignature(round, model);
  const rows = $("activity-pages");
  if (rows.dataset.signature !== signature) {
    rows.dataset.signature = signature;
    rebuildActivityRows(round, model);
  }
  updateActivityRowLabels(round, model);
  syncActivityHandoff(model.failed);
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

// copyResult is the button's text after a click, and the strip keeps it until
// the agent runs the command. When the browser refuses the copy, the frame shows
// the command for the reviewer to select.
let copyResult = null;
async function copyReopen() {
  const command = `pair start --reopen --session-dir ${remote.sessionDir}`;
  const copied = await copyText(command);
  copyResult = copied ? "Copied" : "Copy failed";
  const line = $("reopen-command");
  line.firstElementChild.textContent = command;
  line.hidden = copied;
  renderHistory();
}

function drawPastHistoryLabel(label, { old, past, parent }) {
  const name = document.createElement("b");
  name.className = "place";
  name.textContent = `Round ${old ? plan.round : pastRound}`;
  label.replaceChildren(...crumbTrail([...parent, name]));
  if (past || callHook("shownSubmission")) {
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = " · Sent";
    label.append(meta);
  }
}

function drawHistoryLabel(label, { old, past, parent, unreachable }) {
  if (unreachable) {
    label.replaceChildren(
      "The hub is unreachable. Your draft is saved in this browser.",
    );
    return;
  }
  if (copyResult) {
    const line =
      copyResult === "Copied"
        ? "Paste it into any agent to reopen"
        : "Paste this into any agent to reopen";
    label.replaceChildren(...crumbTrail([line]));
    return;
  }
  if (old && session.closed) {
    const name = document.createElement("b");
    name.textContent = plan.title;
    const state = document.createElement("span");
    state.className = "state";
    state.textContent = " is closed";
    label.replaceChildren(...crumbTrail([...parent.slice(0, 1), name]), state);
    return;
  }
  if (old || past) {
    drawPastHistoryLabel(label, { old, past, parent });
    return;
  }
  const here = document.createElement("b");
  here.textContent = parent[1];
  label.replaceChildren(...crumbTrail([parent[0], here]));
}

const wiredHistoryButtons = new WeakSet();
let historyReturnAction = null;

function syncHistoryButtons({ old, past }) {
  const reopen = $("history-reopen");
  reopen.hidden = !session.closed || !remote?.sessionDir;
  reopen.textContent = copyResult || "Reopen";
  if (!wiredHistoryButtons.has(reopen)) {
    wiredHistoryButtons.add(reopen);
    reopen.addEventListener("click", copyReopen);
  }
  const button = $("history-return");
  button.hidden = old ? session.closed : !past || !currentShown();
  button.textContent = "Back to current";
  historyReturnAction = old
    ? () => location.assign(`${base}/`)
    : () => callHook("switchTab", "current");
  if (!wiredHistoryButtons.has(button)) {
    wiredHistoryButtons.add(button);
    button.addEventListener("click", () => historyReturnAction?.());
  }
}

function historyKey({ old, past, parent, unreachable }) {
  return JSON.stringify([
    old,
    past && pastRound,
    plan.round,
    Boolean(callHook("shownSubmission")),
    parent.map((crumb) => crumb.textContent ?? crumb),
    copyResult,
    unreachable,
  ]);
}

function syncHistoryStripVisibility(hidden, unreachable) {
  const strip = $("history-strip");
  if (strip.hidden !== hidden) {
    strip.hidden = hidden;
    moveFading();
  }
  strip.classList.toggle("unreachable", unreachable);
}

// A tab click leaves the page on screen, so renderHistory shows the strip
// whenever the page on screen belongs to the earlier round, whichever tab
// is selected. A held picture is the page on screen until the move arrives.
export function renderHistory() {
  if (pictureHeld()) return;
  const old = mode === "readonly" || session.closed;
  const past = editable && displayedRound === pastRound;
  const parent = parentCrumbs();
  // After a status poll fails, Send is off, and the strip shows why on every
  // page.
  const unreachable = editable && connected === false;
  const hidden = !(old || past || parent.length || unreachable);
  syncHistoryStripVisibility(hidden, unreachable);
  if (hidden) return;
  const label = $("history-label");
  // renderHistory redraws the line only when it changed, so a pointer on the
  // parent's name keeps its hover state.
  const key = historyKey({ old, past, parent, unreachable });
  if (label.dataset.key !== key) {
    label.dataset.key = key;
    drawHistoryLabel(label, { old, past, parent, unreachable });
  }
  syncHistoryButtons({ old, past });
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
