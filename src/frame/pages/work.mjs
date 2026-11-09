import { $, unreachable } from "#frame/app/util.mjs";
import { land, resumedWorkTab } from "#frame/app/places.mjs";
import { base, editable, embedded, online, session } from "#frame/app/view.mjs";
import { commentTarget } from "#frame/notes/blocks.mjs";
import { images, placeThreads } from "#frame/notes/threads.mjs";
import { readPlace } from "#frame/pages/card-place.mjs";
import {
  fromPage,
  pageLink,
  sessionLink,
  threadLink,
  wordsPlace,
} from "#frame/pages/card-links.mjs";
import { statusBox } from "#frame/pages/card-status.mjs";
import { openNewItem, openStart } from "#frame/pages/start-popup.mjs";
import { listedSession, unreadCards } from "#frame/sync/center.mjs";
import { poll, remote } from "#frame/sync/rounds.mjs";
import { adoptCards, cardKey, markSeen, seenCards } from "#frame/sync/seen.mjs";
import { isClosed } from "#shared/lifecycle.mjs";
import { allows, proposalState } from "#shared/proposal-state.mjs";

/* cardTab() derives a card's tab from proposalState(). A proposed card is in
   Proposed and a running card is in Running. Work started in a sub-session or
   with a new agent has its own session's rounds, so its card goes to Done as
   it starts. The card stays there as the link to that session and the words
   that started it. Every other card is finished, and is in Done. */

export const workTabs = [
  {
    id: "running",
    label: "Running",
    empty: "No work is running in this session.",
  },
  { id: "proposed", label: "Proposed", empty: "No proposed work." },
  { id: "done", label: "Done", empty: "No work is done yet." },
];
// Only work started elsewhere can wait for the reviewer. Work started here
// stays running until the agent marks it done, whatever the state of this
// session's round, because the reviewer answers that round with this
// session's own Send.
const waits = (card, { linked = () => null } = {}) =>
  card.started.where !== "here" &&
  Boolean(linked(card.started.session?.id)?.needsYou);
const tabs = { proposed: "proposed", running: "running" };
export const cardTab = (card) => tabs[proposalState(card)] ?? "done";
export function workGroups(cards) {
  const groups = Object.fromEntries(workTabs.map(({ id }) => [id, []]));
  for (const card of cards) groups[cardTab(card)].push(card);
  return groups;
}
export const openingTab = (groups) =>
  groups.proposed.length
    ? "proposed"
    : workTabs.find(({ id }) => groups[id].length)?.id || workTabs[0].id;

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
  editable && online && Boolean(remote) && !isClosed(remote);
export const proposedCount = () => workGroups(cards()).proposed.length;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const ownSession = "In its own session";
const finishedWords = {
  declined: "Declined",
  withdrawn: "Withdrawn",
  done: "Done",
  joined: "Done",
  closed: "Done",
};
export function cardState(card, shown) {
  const state = proposalState(card);
  if (finishedWords[state]) return [finishedWords[state], "muted"];
  if (shown.unread.has(card.id)) return ["Agent replied", "accent"];
  if (state === "proposed") return ["Proposed", "hollow"];
  if (state === "running") return ["Working here", "accent"];
  if (state === "opening")
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
  return [ownSession, "accent"];
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
// runs. label is the word cardState() gives the card.
function cardWhere(card, label) {
  const state = proposalState(card);
  if (state === "running") return null;
  const box = element("span", "proposal-where");
  const linked = card.started?.session;
  if (state === "joined") {
    const task = cards().find((item) => item.id === card.done.joined);
    box.textContent = `Joined ${task?.title ?? card.done.joined}`;
    box.title = box.textContent;
  } else if (card.done?.where) {
    box.textContent = card.done.where;
    box.title = `Done ${card.done.where}`;
  } else if (state === "closed")
    box.append(sessionLink("Done in its own session", linked));
  else if (state === "linked") {
    if (label !== ownSession) box.append(`${ownSession} · `);
    box.append(sessionLink("Open", linked));
  } else if (state === "opening")
    box.textContent = "Waiting for its session to start";
  else {
    const { page, thread, reviewer } = card.source;
    if (page) box.append(pageLink(fromPage(page), page.round, page.id));
    else if (thread) box.append(threadLink("From a thread", thread));
    else if (reviewer) box.textContent = "You wrote this";
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
// actedOn is the card the reader last pressed a button on. readPlace() keeps that
// card's top in place when the card changes height.
let actedOn = null;
async function act(card, action) {
  actedOn = card.id;
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
// cards from the last poll with them. A card the reviewer pressed a button on
// is on screen already, and a card the reviewer just wrote is not, so Work shows
// the written card, on its tab.
function changed(result, written = null) {
  if (remote && result?.proposals) remote.proposals = result.proposals;
  failure = "";
  openedAt = null;
  const card = written && cards().find((item) => item.id === written);
  const shown = card && !$("work-view").hidden;
  if (shown) selected = cardTab(card);
  refreshWork(true);
  if (shown) land({ target: `proposal-${card.id}` });
  // In the search window's frame, the window's own list shows the card's state.
  if (embedded) window.parent.dispatchEvent(new Event("pair:card"));
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
  const left = element("span", "proposal-foot-start");
  if (allows(card, "restore"))
    left.append(button("link-btn", "Restore", () => act(card, "restore")));
  else if (allows(card, "decline"))
    left.append(button("link-btn", "Decline", () => act(card, "decline")));
  const right = element("span", "proposal-actions");
  if (allows(card, "start"))
    right.append(
      button("btn primary proposal-start", "Start", () =>
        openStart(card, joinedInto(card), (result) => {
          actedOn = card.id;
          changed(result);
        }),
      ),
    );
  return [left, right];
}
export function cardElement(
  card,
  shown = context(),
  fresh = false,
  stays = false,
) {
  const root = element("article", "proposal-card");
  root.dataset.proposalCard = card.id;
  // The comment control uses data-kind to name a chosen card.
  root.dataset.kind = "proposal";
  const head = element("p", "proposal-title");
  head.append(element("b", "", card.title));
  if (fresh) head.append(element("span", "page-new", "New"));
  const [state, tone] = cardState(card, shown);
  const body = element("div", "proposal-body");
  body.append(head, metaLine(state, tone, cardWhere(card, state)));
  // A finished card that stays on screen keeps its status box, and so its height.
  if (allows(card, "status") || (stays && card.started))
    body.append(statusBox(card));
  body.append(element("p", "proposal-delivers", card.delivers));
  if (card.attachments?.length) body.append(images(card));
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
const labelled = (card) => cardsEditable() && cardTab(card) !== "done";
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
      if (shown.length && !embedded)
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
export const workTab = () => selected;
// opening stays true from openWork() until the hub has listed the cards, and
// then refreshWork() selects the tab that Work opens on.
let opening = false;
// openedAt is the target that Work was opened at, such as a bell line's. Once
// the hub lists the card it names, refreshWork() selects that card's tab.
let openedAt = null;
let drawnKey = "";
// drawnTab is the tab whose cards the list shows. It is null while Work opens,
// when the list still shows what it showed when the reader last left Work.
let drawnTab = null;
// staying contains the cards that left the selected tab while they were on
// screen. The list keeps them until the reader changes tab, so the card being
// read does not vanish, and the tab's count can be short of the list until then.
const staying = new Set();
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
    drawnTab = null;
  }
  if (target || !stayed) openedAt = target;
  // A poll also calls show("work"), such as when the next round's Agreed
  // arrives, so only opening Work or a target forces a redraw.
  refreshWork(!stayed || Boolean(target));
}
function selectTab(id) {
  openedAt = null;
  selected = id;
  refreshWork(true);
  $(`work-tab-${id}`)?.focus();
}
// The reviewer has already seen a card they wrote, so it gets no New label.
const openForm = () =>
  openNewItem((result, id) => {
    markSeen(session.sessionId, [id]);
    changed(result, id);
  });
function renderWork(groups, shown, seen) {
  $("work-new").hidden = !cardsEditable();
  $("work-new").onclick = openForm;
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
  list.style.paddingBottom = "";
  drawnTab = selected;
  const listed = cards().filter(
    (card) => cardTab(card) === selected || staying.has(card.id),
  );
  for (const card of listed) if (unseen(card, seen)) marked.add(card.id);
  list.replaceChildren(
    ...(listed.length
      ? listed.map((card) => {
          const node = cardElement(
            card,
            shown,
            marked.has(card.id) && labelled(card),
            staying.has(card.id),
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
  if (remote && !embedded) adoptCards(session.sessionId, cards());
  const seen = seenCards();
  for (const root of mounted.keys())
    if (root.isConnected) paintProposal(root, seen);
    else mounted.delete(root);
  if ($("work-view").hidden) return placeThreads();
  const shown = context();
  const groups = workGroups(cards());
  const named = cardAt(openedAt);
  if (named) {
    selected = cardTab(named);
    openedAt = null;
    opening = false;
  } else if (opening && remote) {
    const kept = resumedWorkTab();
    selected = groups[kept] ? kept : openingTab(groups);
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
    // The first session list brings the seen cards, so Work draws its New
    // labels then.
    Boolean(seen),
  ]);
  // A redraw takes the thread cards out of the list, so the reply box the
  // reviewer is typing in would lose focus and the next keys would reach the
  // frame's shortcuts. The first poll after the reviewer leaves the box draws
  // the change.
  const typing = document.activeElement?.matches("#work-cards textarea");
  const place = selected === drawnTab ? readPlace(actedOn) : null;
  if (force || (key !== drawnKey && !typing)) {
    drawnKey = key;
    if (!place) staying.clear();
    for (const id of place?.cards ?? []) staying.add(id);
    for (const card of groups[selected]) staying.delete(card.id);
    renderWork(groups, shown, seen);
  }
  placeThreads();
  place?.restore();
}
