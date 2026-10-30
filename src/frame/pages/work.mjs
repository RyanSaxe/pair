import { $, unreachable } from "#frame/app/util.mjs";
import { base, editable, online, session } from "#frame/app/view.mjs";
import { commentTarget } from "#frame/notes/blocks.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import {
  fromPage,
  pageLink,
  sessionLink,
  threadLink,
  wordsPlace,
} from "#frame/pages/card-links.mjs";
import { statusBox } from "#frame/pages/card-status.mjs";
import { openStart } from "#frame/pages/start-popup.mjs";
import {
  listedSession,
  sessionsListed,
  unreadCards,
} from "#frame/sync/center.mjs";
import { poll, remote } from "#frame/sync/rounds.mjs";
import { adoptCards, cardKey, markSeen, seenCards } from "#frame/sync/seen.mjs";

/* The hub stores four fields on each card: started, declined, withdrawn and
   done. cardTab() derives a card's tab from them and, for work in a linked
   session, from whether that session's round waits for the reviewer. A
   card that the agent joined into another is done, and its done.joined
   field contains the other card's ID. */

export const workTabs = [
  { id: "needs", label: "Needs you", empty: "Nothing needs you." },
  { id: "running", label: "Running", empty: "No work is running." },
  { id: "proposed", label: "Proposed", empty: "No proposed work." },
  { id: "done", label: "Done", empty: "No work is done yet." },
];
// Only work started elsewhere can wait for the reviewer. Work started here
// stays running until the agent marks it done, whatever the state of this
// session's round, because the reviewer answers that round with this
// session's own Send feedback.
const waits = (card, { linked = () => null } = {}) =>
  card.started.where !== "here" &&
  Boolean(linked(card.started.session?.id)?.needsYou);
const finished = (card) =>
  Boolean(card.declined || card.withdrawn || card.done);
// A card needs the reviewer when its thread has an agent reply that the
// reviewer has not cleared from the bell, or when the linked session that
// runs its work waits for the reviewer.
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
export const openingTab = (groups) =>
  workTabs.find(({ id }) => groups[id].length)?.id || workTabs[0].id;

const cards = () => remote?.proposals || [];
const joinedInto = (card) =>
  cards().filter((item) => item.done?.joined === card.id);
const context = () => ({
  unread: unreadCards(),
  linked: listedSession,
});
// linkedWaits() is part of the draw key in refreshWork(), so a card redraws
// when its linked session starts or stops waiting.
const linkedWaits = () =>
  cards().map((card) =>
    Boolean(listedSession(card.started?.session?.id)?.needsYou),
  );
// Start, Decline and Restore work only in the live session.
export const cardsEditable = () =>
  editable && online && Boolean(remote) && remote.stage !== "complete";
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
function cardState(card, shown) {
  if (card.declined) return ["Declined", "muted"];
  if (card.withdrawn) return ["Withdrawn", "muted"];
  if (card.done) return ["Done", "muted"];
  if (shown.unread.has(card.id)) return ["Agent replied", "accent"];
  if (!card.started) return ["Proposed", "hollow"];
  if (card.started.where === "here") return ["Working here", "accent"];
  if (!card.started.session)
    return card.started.where === "new-agent"
      ? ["Opening a new agent session", "accent"]
      : ["Opening a sub-session", "accent"];
  if (waits(card, shown)) return ["Waiting for you", "ok"];
  // Work started with Plan it first is in planning until the reviewer of its
  // session chooses Build it.
  if (card.started.planFirst && !card.started.built)
    return card.started.where === "new-agent"
      ? ["Planning with a new agent", "accent"]
      : ["Planning in a sub-session", "accent"];
  return ["Working", "accent"];
}
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
// Running work started here has no line, because its state says where it
// runs.
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
    const { page, thread } = card.source;
    if (page) box.append(pageLink(fromPage(page), page.round, page.id));
    else if (thread) box.append(threadLink("From a thread", thread));
    else return null;
  }
  return box;
}
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
// The hub answers each action with every card, and changed() replaces the
// cards from the last poll with them. After Start, Work shows the tab that
// the card moved to.
function changed(result, follow = null) {
  if (remote && result?.proposals) remote.proposals = result.proposals;
  failure = "";
  followed = null;
  const moved = follow && cards().find((card) => card.id === follow);
  if (moved && !$("work-view").hidden) selected = cardTab(moved, context());
  refreshWork(true);
  // poll() fetches the rest of what the action changed, such as the thread
  // that Open a new agent session starts.
  void poll();
}
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
  if (proposed)
    right.append(
      button("btn primary proposal-start", "Start", () =>
        openStart(card, joinedInto(card), (result) => changed(result, card.id)),
      ),
    );
  return [left, right];
}
export function cardElement(card, shown = context(), fresh = false) {
  const root = element("article", "proposal-card");
  root.dataset.proposalCard = card.id;
  // The comment control uses data-kind to name a chosen card.
  root.dataset.kind = "proposal";
  const head = element("p", "proposal-title");
  head.append(element("b", "", card.title));
  if (fresh) head.append(element("span", "page-new", "New"));
  const [state, tone] = cardState(card, shown);
  const body = element("div", "proposal-body");
  body.append(head, metaLine(state, tone, cardWhere(card)));
  if (card.started && !finished(card)) body.append(statusBox(card));
  body.append(element("p", "proposal-delivers", card.delivers));
  // cardElement() quotes the reviewer's words that started the card, or the
  // reviewer's message with Start, so the card shows everything the reviewer
  // approved.
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
  const joined = joinedInto(card);
  if (joined.length) body.append(joinedList(joined));
  root.append(body);
  const buttons = cardsEditable() ? actions(card) : [];
  if (buttons.some((side) => side.children.length)) {
    const foot = element("div", "proposal-foot");
    foot.append(...buttons);
    root.append(foot);
  }
  return root;
}

/* The frame labels a card New on Work when the card is in a live session,
   is not in Done, and no browser on the hub has shown it on Work. Showing
   the card on a page does not count. The frame keeps the label on a card
   on screen until Work opens again, so the label does not vanish while the
   reviewer reads the card. */
const labelled = (card) => cardsEditable() && !finished(card);
const unseen = (card, seen) =>
  labelled(card) &&
  Boolean(seen) &&
  !seen.has(cardKey(session.sessionId, card.id));
let marked = new Set();
let watcher = null;
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

let selected = workTabs[0].id;
// opening stays true from openWork() until the hub has listed the cards and
// the sessions their work runs in, and then refreshWork() selects the first
// tab with a card in it.
let opening = false;
// followed is the target that Work was opened at, such as a bell line's.
// While it names a card, the frame shows that card's tab and follows the
// card when it changes tab, until the reader picks a tab or acts on a card.
let followed = null;
let drawnKey = "";
function cardAt(target) {
  if (!target) return null;
  const thread = (remote?.threads || []).find(
    ({ id, proposal }) =>
      proposal &&
      (target === `thread-${id}` || target.startsWith(`thread-${id}-`)),
  );
  const id =
    thread?.proposal ??
    (target.startsWith("proposal-") ? target.slice("proposal-".length) : null);
  return cards().find((card) => card.id === id) || null;
}
// When Work is already on screen, openWork() keeps its tab unless a target
// names a card.
export function openWork(target, stayed) {
  if (!stayed) {
    opening = true;
    failure = "";
    marked = new Set();
  }
  if (target || !stayed) followed = target;
  // A poll also calls show("work"), such as when the next round's Agreed
  // arrives, so only opening Work or a target forces a redraw.
  refreshWork(!stayed || Boolean(target));
}
function selectTab(id) {
  followed = null;
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
      ? chosen.map((card) => {
          const node = cardElement(
            card,
            shown,
            marked.has(card.id) && labelled(card),
          );
          // A bell line links to the card by this ID.
          node.id = `proposal-${card.id}`;
          return node;
        })
      : [
          element(
            "p",
            "work-empty",
            workTabs.find(({ id }) => id === selected).empty,
          ),
        ]),
  );
  watchCards(list);
  // The chosen card was drawn again or left the tab, so commentTarget()
  // finds it again by its ID or ends the choice.
  commentTarget();
}
/* On a page, drawProposal() shows the card that the hub has under the ID, or
   the text the author wrote when no hub has the card. */
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
export function refreshWork(force = false) {
  if (remote) adoptCards(session.sessionId, cards());
  const seen = seenCards();
  for (const root of mounted.keys())
    if (root.isConnected) paintProposal(root, seen);
    else mounted.delete(root);
  if ($("work-view").hidden) return placeThreads();
  const shown = context();
  const groups = workGroups(cards(), shown);
  // The frame needs the session listing to know whether a card whose work
  // runs in another session waits for the reviewer.
  const linkedKnown =
    sessionsListed() ||
    !cards().some((card) => card.started && card.started.where !== "here");
  const named = cardAt(followed);
  if (named) {
    selected = cardTab(named, shown);
    opening = false;
  } else if (opening && remote && linkedKnown) {
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
  // A redraw takes the thread cards out of the list, so the reply box the
  // reviewer is typing in would lose focus and the next keys would reach the
  // frame's shortcuts. The first poll after the reviewer leaves the box draws
  // the change.
  const typing = document.activeElement?.matches("#work-cards textarea");
  if (force || (key !== drawnKey && !typing)) {
    drawnKey = key;
    renderWork(groups, shown, seen);
  }
  placeThreads();
}
