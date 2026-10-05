import { $, plural, unreachable } from "#frame/app/util.mjs";
import { base, editable, online, session } from "#frame/app/view.mjs";
import { openCardNote } from "#frame/notes/notes.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import {
  fromPage,
  pageLink,
  sessionLink,
  threadLink,
  wordsPlace,
} from "#frame/pages/card-links.mjs";
import { openStart } from "#frame/pages/start-popup.mjs";
import {
  listedSession,
  sessionsListed,
  unreadCards,
} from "#frame/sync/center.mjs";
import { poll, remote } from "#frame/sync/rounds.mjs";
import { adoptCards, cardKey, markSeen, seenCards } from "#frame/sync/seen.mjs";

/* The Work page holds every proposal of the session, from the agent's pair
   propose until the work is done, in four tabs. The hub stores five facts
   on each card, plan, started, declined, withdrawn and done, and the tab
   follows from them and, for work in a linked session, from whether that
   session's round waits for the reviewer. A card the agent joined into
   another is done, and its done fact names that card. A page shows the
   same card with the proposal component. */

export const workTabs = [
  { id: "needs", label: "Needs you", empty: "Nothing needs you." },
  { id: "running", label: "Running", empty: "No work is running." },
  { id: "proposed", label: "Proposed", empty: "No proposed work." },
  { id: "done", label: "Done", empty: "No work is done yet." },
];
// Whether the linked session that runs work started elsewhere waits for
// the reviewer. Work started here runs until the agent marks it done,
// whatever this session's round does, because the reviewer answers that
// round with this session's own Send feedback.
const waits = (card, { linked = () => null } = {}) =>
  card.started.where !== "here" &&
  Boolean(linked(card.started.session?.id)?.needsYou);
// A card the reviewer declined or the agent withdrew is listed with the
// done ones.
const finished = (card) =>
  Boolean(card.declined || card.withdrawn || card.done);
// A card needs the reviewer when its thread has an agent reply they have
// not cleared from the bell, or when the linked session its work runs in
// waits for them.
export function cardTab(card, context = {}) {
  if (context.unread?.has(card.id)) return "needs";
  if (finished(card)) return "done";
  if (card.started) return waits(card, context) ? "needs" : "running";
  return "proposed";
}
export function workGroups(cards, context) {
  const groups = Object.fromEntries(workTabs.map(({ id }) => [id, []]));
  for (const card of cards) groups[cardTab(card, context)].push(card);
  return groups;
}
// Work opens on the first tab with a card in it.
export const openingTab = (groups) =>
  workTabs.find(({ id }) => groups[id].length)?.id || workTabs[0].id;

const cards = () => remote?.proposals || [];
// The cards the agent joined into a card, because that card's work covers
// theirs.
const joinedInto = (card) =>
  cards().filter((item) => item.done?.joined === card.id);
const context = () => ({
  unread: unreadCards(),
  linked: listedSession,
});
// Which linked sessions wait for the reviewer, so a card redraws when one
// starts or stops waiting.
const linkedWaits = () =>
  cards().map((card) =>
    Boolean(listedSession(card.started?.session?.id)?.needsYou),
  );
// Start, Decline, Restore and Comment need the live session.
export const cardsEditable = () =>
  editable && online && Boolean(remote) && remote.stage !== "complete";
// The two numbers on the Work row: the cards that need the reviewer and
// the proposed cards.
export function workCounts() {
  const { needs, proposed } = workGroups(cards(), context());
  return { needs: needs.length, proposed: proposed.length };
}

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// A card's state and the tone of its dot: Working here and Working in the
// accent, Waiting for you in green, Done, Declined and Withdrawn in grey,
// and a proposed card, which its tab already names, by its plan with a
// hollow dot. Work started in a sub-session or with a new agent reads
// Opening until its session links, and the two look the same after that.
function cardState(card, shown) {
  if (card.declined) return ["Declined", "muted"];
  if (card.withdrawn) return ["Withdrawn", "muted"];
  if (card.done) return ["Done", "muted"];
  if (shown.unread.has(card.id)) return ["Agent replied", "accent"];
  if (!card.started)
    return [card.plan ? "Plan ready" : "No plan yet", "hollow"];
  if (card.started.where === "here") return ["Working here", "accent"];
  if (!card.started.session)
    return card.started.where === "new-agent"
      ? ["Opening a new agent session", "accent"]
      : ["Opening a sub-session", "accent"];
  return waits(card, shown) ? ["Waiting for you", "ok"] : ["Working", "accent"];
}
// The line under a card's title, here and on Agreed: a dot and a state,
// then text that an ellipsis cuts short when the line is full.
export function metaLine(state, tone, rest) {
  const line = element("div", "card-meta");
  if (state) {
    const dot = element("span", "state-dot");
    dot.dataset.tone = tone;
    line.append(dot, element("span", "card-state", state));
  }
  if (state && rest) line.append(element("span", "", "·"));
  if (rest) {
    rest.classList.add("card-rest");
    line.append(rest);
  }
  return line;
}
// Where the card came from, for work started elsewhere where it runs, for
// work the agent marked done with --where, where it got done, and for a
// card joined into another, that card's title. Running work started here
// has no line, since its state says where it runs, and a card names no
// round.
function cardWhere(card) {
  if (card.started?.where === "here" && !card.done) return null;
  const box = element("span", "proposal-where");
  const linked = card.started?.session;
  if (card.done?.joined) {
    const task = cards().find((item) => item.id === card.done.joined);
    box.textContent = `Joined ${task?.title ?? card.done.joined}`;
    box.title = box.textContent;
  } else if (card.done?.where) {
    box.textContent = card.done.where;
    box.title = `Done ${card.done.where}`;
  } else if (card.started && card.started.where !== "here") {
    if (card.done) box.append(sessionLink("Done in its own session", linked));
    else if (linked)
      box.append("In its own session · ", sessionLink("Open", linked));
    else box.textContent = "Waiting for its session to start";
  } else {
    // A card recorded with neither --page nor --thread has no line.
    const { page, thread } = card.source;
    if (page) box.append(pageLink(fromPage(page), page.round, page.id));
    else if (thread) box.append(threadLink("From a thread", thread));
    else return null;
  }
  return box;
}
// A card's plan: its pages, when it last changed and, when it differs, the
// rounds it came from, which pair plan names as one round or a range such
// as 3-6.
export function planLine(plan) {
  const range = plan.rounds.match(/^(\d+)-(\d+)$/);
  const from = range
    ? `from rounds ${range[1]} to ${range[2]}`
    : `from round ${plan.rounds}`;
  const parts = plan.pages?.length ? [plural(plan.pages.length, "page")] : [];
  // A plan from a linked session names that session's rounds.
  if (plan.session) parts.push(`${from} of its own session`);
  else if (!plan.round) parts.push(from);
  else {
    parts.push(`updated after round ${plan.round}`);
    if (plan.rounds !== plan.round) parts.push(from);
  }
  return parts.join(" · ");
}
const icons = {
  plan: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
};
function icon(name) {
  const box = element("span", "card-icon");
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
  return box;
}
// The plan's line: Open shows the plan in this tab, and the download icon
// saves its file.
function planRow(card) {
  const row = element("div", "proposal-plan");
  const text = element("span", "card-rest");
  text.append(element("b", "", "Plan"), ` · ${planLine(card.plan)}`);
  text.title = text.textContent;
  const plan = `${base}/plans/${encodeURIComponent(card.id)}/`;
  const open = element("a", "proposal-plan-open", "Open");
  open.href = plan;
  open.setAttribute("aria-label", "Open plan");
  const download = element("a", "proposal-plan-download");
  download.href = `${plan}download`;
  download.download = `${card.id}-plan.html`;
  download.title = "Download plan";
  download.setAttribute("aria-label", "Download plan");
  download.append(icon("download"));
  row.append(icon("plan"), text, open, download);
  return row;
}
// The cards joined into a card, by title, under a rule at the foot of its
// body.
function joinedList(joined) {
  const box = element("div", "proposal-joined");
  const list = element("ul");
  list.append(...joined.map((item) => element("li", "", item.title)));
  box.append(
    element("p", "proposal-joined-label", "Joined into this proposal"),
    list,
  );
  return box;
}
let failure = "";
async function act(card, action) {
  try {
    const response = await fetch(
      `${base}/api/proposals/${encodeURIComponent(card.id)}/${action}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The hub refused it.");
    failure = "";
    changed(result);
  } catch (error) {
    failure = unreachable(error);
    refreshWork(true);
  }
}
// The hub answers each action with every card, which replaces the cards of
// the last poll. After Start, Work shows the tab the card moved to.
function changed(result, follow = null) {
  if (remote && result?.proposals) remote.proposals = result.proposals;
  failure = "";
  const moved = follow && cards().find((card) => card.id === follow);
  if (moved && !$("work").hidden) selected = cardTab(moved, context());
  refreshWork(true);
  // The next status shows the rest of what the action changed, such as the
  // thread that Open a new agent session starts.
  void poll();
}
// The footer holds only buttons, in one row: Decline or Restore on the
// left, and Comment and Start on the right.
function actions(card) {
  const button = (className, label, run) => {
    const node = element("button", className, label);
    node.type = "button";
    node.onclick = run;
    return node;
  };
  const proposed = !card.started && !finished(card);
  const left = element("span", "proposal-foot-start");
  if (card.declined || card.withdrawn)
    left.append(button("link-btn", "Restore", () => act(card, "restore")));
  else if (proposed)
    left.append(button("link-btn", "Decline", () => act(card, "decline")));
  const right = element("span", "proposal-actions");
  right.append(button("link-btn", "Comment", () => openCardNote(card)));
  if (proposed)
    right.append(
      button("btn primary proposal-start", "Start", () =>
        openStart(card, joinedInto(card), (result) => changed(result, card.id)),
      ),
    );
  return [left, right];
}
// One card, the same on Work and in the proposal component, with the New
// label when fresh.
export function cardElement(card, shown = context(), fresh = false) {
  const root = element("article", "proposal-card");
  root.dataset.proposalCard = card.id;
  const head = element("p", "proposal-title");
  head.append(element("b", "", card.title));
  if (fresh) head.append(element("span", "page-new", "New"));
  const [state, tone] = cardState(card, shown);
  const body = element("div", "proposal-body");
  body.append(
    head,
    metaLine(state, tone, cardWhere(card)),
    element("p", "proposal-delivers", card.delivers),
  );
  // The reviewer's words that started the card, or their message with
  // Start, quoted under what the card delivers, so the card shows
  // everything the reviewer approved.
  const { started, withdrawn } = card;
  if (started?.by === "words") {
    const lead = element("p", "proposal-lead", "Started from your words");
    const place = wordsPlace(started);
    if (place) lead.append(" ", place);
    body.append(lead);
  }
  const quoted = started?.quote ?? started?.message;
  if (quoted) body.append(element("p", "proposal-message", `“${quoted}”`));
  if (withdrawn)
    body.append(
      element(
        "p",
        "proposal-reason",
        `The agent's reason: ${withdrawn.reason}`,
      ),
    );
  if (card.plan) body.append(planRow(card));
  const joined = joinedInto(card);
  if (joined.length) body.append(joinedList(joined));
  root.append(body);
  // A card that cannot change has no buttons, and so no footer.
  if (cardsEditable()) {
    const foot = element("div", "proposal-foot");
    foot.append(...actions(card));
    root.append(foot);
  }
  return root;
}

/* New: a card in a live session that this browser has not had on screen
   on Work, unless it is in Done. A card on a page counts as seen only once
   Work shows it. On Work, a card keeps the label until Work opens again, so
   it does not lose it while the reviewer reads it. */
const labelled = (card) => cardsEditable() && !finished(card);
const unseen = (card, seen) =>
  labelled(card) &&
  Boolean(seen) &&
  !seen.has(cardKey(session.sessionId, card.id));
let marked = new Set();
let watcher = null;
// Records each card on screen on Work as seen, once half of it shows.
function watchCards(list) {
  watcher?.disconnect();
  watcher = new IntersectionObserver(
    (entries, observer) => {
      const shown = entries.filter((entry) => entry.isIntersecting);
      for (const entry of shown) observer.unobserve(entry.target);
      if (shown.length)
        markSeen(
          session.sessionId,
          shown.map((entry) => entry.target.dataset.proposalCard),
        );
    },
    { threshold: 0.5 },
  );
  for (const node of list.querySelectorAll("[data-proposal-card]"))
    watcher.observe(node);
}

/* The page */
let selected = workTabs[0].id;
// Opening Work starts on the first tab with a card in it, once the hub has
// listed the cards and the sessions their work runs in.
let opening = false;
let drawnKey = "";
export function openWork() {
  opening = true;
  failure = "";
  marked = new Set();
  refreshWork(true);
}
function selectTab(id) {
  selected = id;
  refreshWork(true);
  $(`work-tab-${id}`)?.focus();
}
function renderWork(groups, shown, seen) {
  const tabs = $("work-tabs");
  tabs.replaceChildren(
    ...workTabs.map(({ id, label }) => {
      const tab = element("button", "work-tab");
      tab.type = "button";
      tab.id = `work-tab-${id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(id === selected));
      tab.setAttribute("aria-controls", "work-cards");
      tab.tabIndex = id === selected ? 0 : -1;
      tab.append(
        label,
        element("span", "work-count", String(groups[id].length)),
      );
      tab.onclick = () => selectTab(id);
      return tab;
    }),
  );
  tabs.onkeydown = (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const index = workTabs.findIndex(({ id }) => id === selected);
    selectTab(workTabs[(index + step + workTabs.length) % workTabs.length].id);
  };
  $("work-error").textContent = failure;
  $("work-error").hidden = !failure;
  const list = $("work-cards");
  list.setAttribute("aria-labelledby", `work-tab-${selected}`);
  const chosen = groups[selected];
  for (const card of chosen) if (unseen(card, seen)) marked.add(card.id);
  list.replaceChildren(
    ...(chosen.length
      ? chosen.map((card) =>
          cardElement(card, shown, marked.has(card.id) && labelled(card)),
        )
      : [
          element(
            "p",
            "work-empty",
            workTabs.find(({ id }) => id === selected).empty,
          ),
        ]),
  );
  watchCards(list);
}
/* The component on a page: the card the hub has under the ID, or the text
   the author wrote where no hub has the card. */
const mounted = new Map();
export function drawProposal(root) {
  mounted.set(root, "");
  paintProposal(root);
}
function paintProposal(root, seen = seenCards()) {
  const card = cards().find((item) => item.id === root.dataset.proposal);
  if (!card) return;
  const shown = context();
  const fresh = unseen(card, seen);
  const key = JSON.stringify([
    card,
    joinedInto(card).map((item) => item.title),
    Boolean(listedSession(card.started?.session?.id)?.needsYou),
    shown.unread.has(card.id),
    cardsEditable(),
    remote?.current?.round,
    fresh,
  ]);
  if (mounted.get(root) === key) return;
  mounted.set(root, key);
  root.dataset.proposalCard = card.id;
  root.replaceChildren(cardElement(card, shown, fresh));
}
// Every poll and every action draws the cards again when they changed.
export function refreshWork(force = false) {
  if (remote) adoptCards(session.sessionId, cards());
  const seen = seenCards();
  for (const root of mounted.keys())
    if (root.isConnected) paintProposal(root, seen);
    else mounted.delete(root);
  if ($("work").hidden) return placeThreads();
  const shown = context();
  const groups = workGroups(cards(), shown);
  // A card whose work runs in another session needs the session listing to
  // know whether it waits for the reviewer.
  const linkedKnown =
    sessionsListed() ||
    !cards().some((card) => card.started && card.started.where !== "here");
  if (opening && remote && linkedKnown) {
    selected = openingTab(groups);
    opening = false;
  }
  const key = JSON.stringify([
    cards(),
    linkedWaits(),
    [...shown.unread],
    selected,
    failure,
    cardsEditable(),
    remote?.current?.round,
  ]);
  if (force || key !== drawnKey) {
    drawnKey = key;
    renderWork(groups, shown, seen);
  }
  placeThreads();
}
