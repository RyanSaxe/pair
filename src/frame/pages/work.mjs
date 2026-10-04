import { $, unreachable } from "#frame/app/util.mjs";
import { base, editable, online } from "#frame/app/view.mjs";
import { openCardNote } from "#frame/notes/notes.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import { openStart } from "#frame/pages/start-popup.mjs";
import { unreadCards } from "#frame/sync/center.mjs";
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
// A card needs the reviewer when its thread has an agent reply they have
// not cleared from the bell, or when it runs here and the session's round
// waits for them. A declined card is listed with the done ones.
export function cardTab(card, { needsYou = false, unread = new Set() } = {}) {
  if (unread.has(card.id)) return "needs";
  if (card.declined || card.done) return "done";
  if (card.started) return needsYou ? "needs" : "running";
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
});
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
// The tag after a card's title and its class: Working in the accent,
// Waiting for you in green, Done and Declined in grey.
function cardTag(card, { needsYou, unread }) {
  if (card.declined) return ["Declined", "muted"];
  if (card.done) return ["Done", "muted"];
  if (unread.has(card.id)) return ["Agent replied", ""];
  if (card.started)
    return needsYou ? ["Waiting for you", "ok"] : ["Working", ""];
  return null;
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
// The footer's left side: where the card came from, or for started work
// where it runs.
function cardWhere(card, { needsYou }) {
  const box = element("span", "proposal-where");
  if (card.done && !card.declined) {
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
// A card's plan: when it last changed and the rounds it came from, which
// pair plan names as one round or a range such as 3-6.
export function planLine(plan) {
  if (!plan) return "No plan yet.";
  const range = plan.rounds.match(/^(\d+)-(\d+)$/);
  const from = range
    ? `from rounds ${range[1]} to ${range[2]}`
    : `from round ${plan.rounds}`;
  return plan.round
    ? `Plan updated after round ${plan.round}, ${from}.`
    : `Plan ${from}.`;
}
// Open plan shows the plan in this tab, and Download plan saves its file.
function planLinks(card) {
  const box = element("span", "proposal-plan-links");
  const plan = `${base}/plans/${encodeURIComponent(card.id)}/`;
  const open = element("a", "", "Open plan");
  open.href = plan;
  const download = element("a", "", "Download plan");
  download.href = `${plan}download`;
  download.download = `${card.id}-plan.html`;
  box.append(open, element("span", "proposal-dot", " · "), download);
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
// the last poll.
function changed(result) {
  if (remote && result?.proposals) remote.proposals = result.proposals;
  failure = "";
  refreshWork(true);
  // A Start can answer the round, which the next status shows.
  void poll();
}
function actions(card) {
  const box = element("span", "proposal-actions");
  if (!cardsEditable()) return box;
  const link = (label, run) => {
    const button = element("button", "link-btn", label);
    button.type = "button";
    button.onclick = run;
    if (box.childElementCount) box.append(element("span", "proposal-dot", "·"));
    box.append(button);
  };
  if (card.declined) link("Restore", () => act(card, "restore"));
  else if (!card.started) link("Decline", () => act(card, "decline"));
  link("Comment", () => openCardNote(card));
  if (!card.started && !card.declined) {
    const start = element("button", "btn proposal-start", "Start");
    start.type = "button";
    start.onclick = () => openStart(card, changed);
    box.append(start);
  }
  return box;
}
// One card, the same on Work and in the proposal component.
export function cardElement(card, shown = context()) {
  const root = element("article", "proposal-card");
  root.dataset.proposalCard = card.id;
  const head = element("p", "proposal-title");
  head.append(element("b", "", card.title));
  const tag = cardTag(card, shown);
  if (tag) {
    head.append(element("span", `tag ${tag[1]}`.trim(), tag[0]));
  }
  if (card.plan) head.append(element("span", "tag", "Plan"));
  const body = element("div", "proposal-body");
  body.append(head, element("p", "proposal-delivers", card.delivers));
  // Work that started without a plan needs no line saying it has none.
  if (card.plan || !(card.started || card.declined || card.done))
    body.append(element("p", "proposal-plan", planLine(card.plan)));
  const foot = element("div", "proposal-foot");
  // The plan's links take the place of where the card came from, which
  // the plan's line names, and follow where started work runs.
  const where = element("span", "proposal-foot-start");
  if (!card.plan || card.started) where.append(cardWhere(card, shown));
  if (card.plan) {
    if (where.childElementCount)
      where.append(element("span", "proposal-dot", " · "));
    where.append(planLinks(card));
  }
  foot.append(where, actions(card));
  root.append(body, foot);
  return root;
}

/* The page */
let selected = workTabs[0].id;
// Opening Work starts on the first tab with a card in it, once the hub has
// listed the cards.
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
  if (opening && remote) {
    selected = openingTab(groups);
    opening = false;
  }
  const key = JSON.stringify([
    cards(),
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
