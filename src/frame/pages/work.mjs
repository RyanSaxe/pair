import { $, plural, unreachable } from "#frame/app/util.mjs";
import { base, editable, online } from "#frame/app/view.mjs";
import { openCardNote } from "#frame/notes/notes.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import { openStart } from "#frame/pages/start-popup.mjs";
import {
  listedSession,
  sessionsListed,
  unreadCards,
} from "#frame/sync/center.mjs";
import { poll, remote } from "#frame/sync/rounds.mjs";

/* The Work page holds every proposal of the session, from the agent's pair
   propose until the work is done, in four tabs. The hub stores four facts
   on each card, plan, started, declined and done, and the tab follows from
   them and from whether the session's round waits for the reviewer. A page
   shows the same card with the proposal component. */

export const workTabs = [
  { id: "needs", label: "Needs you", empty: "Nothing needs you." },
  { id: "running", label: "Running", empty: "No work is running." },
  { id: "proposed", label: "Proposed", empty: "No proposed work." },
  { id: "done", label: "Done", empty: "No work is done yet." },
];
// Whether the round that started work waits for the reviewer: this
// session's for work here, and the linked session's for work anywhere else.
const waits = (card, { needsYou = false, linked = () => null } = {}) =>
  card.started.where === "here"
    ? needsYou
    : Boolean(linked(card.started.session?.id)?.needsYou);
// A card needs the reviewer when its thread has an agent reply they have
// not cleared from the bell, or when the round its work runs in waits for
// them. A declined card is listed with the done ones.
export function cardTab(card, context = {}) {
  if (context.unread?.has(card.id)) return "needs";
  if (card.declined || card.done) return "done";
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
const context = () => ({
  needsYou: Boolean(remote?.needsYou),
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
// The number on the Work row.
export const workCount = () => workGroups(cards(), context()).needs.length;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// A card's state and the tone of its dot: Working in the accent, Waiting
// for you in green, Done and Declined in grey, and a proposed card, which
// its tab already names, by its plan with a hollow dot.
// Work started in a sub-session or with a new agent reads Opening until
// its session links, and the two look the same after that.
function cardState(card, shown) {
  if (card.declined) return ["Declined", "muted"];
  if (card.done) return ["Done", "muted"];
  if (shown.unread.has(card.id)) return ["Agent replied", "accent"];
  if (!card.started)
    return [card.plan ? "Plan ready" : "No plan yet", "hollow"];
  if (card.started.where !== "here" && !card.started.session)
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
// A link to the session work runs in, which opens in this tab.
function sessionLink(text, session) {
  const link = element("a", "", text);
  link.href = session.url;
  return link;
}
// A link to a page of a round: in place for the round on screen, and on
// the round's read-only page for an earlier one.
function pageLink(text, round, id) {
  const link = element("a", "", text);
  if (round === remote?.current?.round && editable) {
    link.href = `#${id}`;
    link.dataset.page = id;
  } else link.href = `${base}/r/${encodeURIComponent(round)}#${id}`;
  return link;
}
function threadLink(text, id) {
  const thread = remote?.threads?.find((item) => item.id === id);
  if (!thread) return element("span", "", text);
  const link = element("a", "", text);
  const target = `?target=thread-${encodeURIComponent(id)}`;
  if (thread.proposal) link.href = `${target}#work`;
  else
    link.href =
      thread.round === remote.current?.round
        ? `${base}/${target}#${thread.topic}`
        : `${base}/r/${encodeURIComponent(thread.round)}${target}#${thread.topic}`;
  return link;
}
// Where the card came from, or for started work where it runs.
function cardWhere(card, { needsYou }) {
  const box = element("span", "proposal-where");
  const linked = card.started?.session;
  if (card.started && card.started.where !== "here") {
    if (card.done) box.append(sessionLink("Done in its own session", linked));
    else if (linked)
      box.append("In its own session · ", sessionLink("Open", linked));
    else box.textContent = "Waiting for its session to start";
  } else if (card.done && !card.declined) {
    const round = card.done.round;
    box.append(
      round
        ? pageLink(`Done here in round ${round}`, round, "agreed")
        : "Done here",
    );
  } else if (card.started) {
    const round = remote?.current?.round;
    if (needsYou && round)
      box.append(
        pageLink(`Here, round ${round} waits for you`, round, "agreed"),
      );
    else
      box.textContent = remote?.openRound
        ? `Here, in this session's round ${remote.openRound.round}`
        : "Here, in this session's next round";
  } else {
    const { text, page, thread } = card.source;
    box.append(
      page
        ? pageLink(text, page.round, page.id)
        : thread
          ? threadLink(text, thread)
          : text,
    );
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
  // A Start can answer the round, which the next status shows.
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
  const left = element("span", "proposal-foot-start");
  if (card.declined)
    left.append(button("link-btn", "Restore", () => act(card, "restore")));
  else if (!card.started)
    left.append(button("link-btn", "Decline", () => act(card, "decline")));
  const right = element("span", "proposal-actions");
  right.append(button("link-btn", "Comment", () => openCardNote(card)));
  if (!card.started && !card.declined)
    right.append(
      button("btn primary proposal-start", "Start", () =>
        openStart(card, (result) => changed(result, card.id)),
      ),
    );
  return [left, right];
}
// One card, the same on Work and in the proposal component.
export function cardElement(card, shown = context()) {
  const root = element("article", "proposal-card");
  root.dataset.proposalCard = card.id;
  const head = element("p", "proposal-title");
  head.append(element("b", "", card.title));
  const [state, tone] = cardState(card, shown);
  const body = element("div", "proposal-body");
  body.append(
    head,
    metaLine(state, tone, cardWhere(card, shown)),
    element("p", "proposal-delivers", card.delivers),
  );
  if (card.plan) body.append(planRow(card));
  root.append(body);
  // A card that cannot change has no buttons, and so no footer.
  if (cardsEditable()) {
    const foot = element("div", "proposal-foot");
    foot.append(...actions(card));
    root.append(foot);
  }
  return root;
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
  refreshWork(true);
}
function selectTab(id) {
  selected = id;
  refreshWork(true);
  $(`work-tab-${id}`)?.focus();
}
function renderWork(groups, shown) {
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
  list.replaceChildren(
    ...(chosen.length
      ? chosen.map((card) => cardElement(card, shown))
      : [
          element(
            "p",
            "work-empty",
            workTabs.find(({ id }) => id === selected).empty,
          ),
        ]),
  );
}
/* The component on a page: the card the hub has under the ID, or the text
   the author wrote where no hub has the card. */
const mounted = new Map();
export function drawProposal(root) {
  mounted.set(root, "");
  paintProposal(root);
}
function paintProposal(root) {
  const card = cards().find((item) => item.id === root.dataset.proposal);
  if (!card) return;
  const shown = context();
  const key = JSON.stringify([
    card,
    Boolean(listedSession(card.started?.session?.id)?.needsYou),
    shown.needsYou,
    shown.unread.has(card.id),
    cardsEditable(),
    remote?.current?.round,
  ]);
  if (mounted.get(root) === key) return;
  mounted.set(root, key);
  root.dataset.proposalCard = card.id;
  root.replaceChildren(cardElement(card, shown));
}
// Every poll and every action draws the cards again when they changed.
export function refreshWork(force = false) {
  for (const root of mounted.keys())
    if (root.isConnected) paintProposal(root);
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
    shown.needsYou,
    [...shown.unread],
    selected,
    failure,
    cardsEditable(),
    remote?.current?.round,
    remote?.openRound?.round,
  ]);
  if (force || key !== drawnKey) {
    drawnKey = key;
    renderWork(groups, shown);
  }
  placeThreads();
}
