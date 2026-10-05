import { ago, since } from "#frame/app/time.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  base,
  currentShown,
  editable,
  mode,
  noteEditable,
  online,
  page,
  pastRound,
  plan,
  planFor,
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
// Crumbs separated by chevrons.
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
// Inside a linked session, the line under the header names the session it
// came from, as the way back, then this session. The hub names the parent
// in the page and in each status.
function parentCrumbs() {
  const parent = remote?.parent || session.parent;
  if (!parent) return [];
  const link = document.createElement("a");
  link.href = parent.url;
  link.textContent = parent.title;
  return [link, remote?.current?.title || plan.title];
}
function drawHistoryLabel(label, old, past, parent) {
  // A closed session names itself, after its parent when it has one.
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
// Every page of a past round, its Feedback page included, names the
// round. Current never has the strip. A tab click leaves the page on screen,
// so the strip shows whenever that page belongs to the earlier round,
// whichever tab is chosen. A linked session always shows the strip, with
// its parent's name first.
export function renderHistory() {
  if (planFor) return renderPlanStrip();
  const old = mode === "readonly";
  const past = editable && displayedRound === pastRound;
  const parent = parentCrumbs();
  const strip = $("history-strip");
  strip.hidden = !(old || past || parent.length);
  if (strip.hidden) return;
  const label = $("history-label");
  // A poll redraws the line only when it changed, so a pointer on the
  // parent's name keeps its hover.
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
// A plan's strip leads back to Work, names the card and offers Download
// plan. A downloaded plan has no hub, so it names the card alone.
let planStrip = "";
function renderPlanStrip() {
  const title =
    remote?.proposals?.find((card) => card.id === planFor)?.title || plan.title;
  if (planStrip === title) return;
  planStrip = title;
  $("history-strip").hidden = false;
  $("history-return").hidden = true;
  const crumbs = [];
  if (online) {
    const work = document.createElement("a");
    work.href = `${base}/#work`;
    work.textContent = "Work";
    crumbs.push(work);
  }
  crumbs.push(title);
  const here = document.createElement("b");
  here.className = "place";
  here.textContent = "Plan";
  crumbs.push(here);
  $("history-label").replaceChildren(...crumbTrail(crumbs));
  const download = $("history-download");
  download.hidden = !online;
  download.href = `${base}/plans/${encodeURIComponent(planFor)}/download`;
}
// The Pages heading in the sidebar shows the page round's status. The text stays while the status fades out.
export function renderRound() {
  const model = editable ? roundModel({ remote }) : null;
  for (const status of document.querySelectorAll("[data-round-status]")) {
    status.classList.toggle("idle", !model);
    status.classList.toggle("late", Boolean(model?.late));
    if (model) status.lastElementChild.textContent = model.text;
  }
}
