import { callHook } from "#frame/app/hooks.mjs";
import { land, resumedWorkTab } from "#frame/app/places.mjs";
import { remote } from "#frame/app/state.mjs";
import { $, unreachable } from "#frame/app/util.mjs";
import { base, embedded, session } from "#frame/app/view.mjs";
import { commentTarget } from "#frame/notes/blocks.mjs";
import { images, placeThreads } from "#frame/notes/threads.mjs";
import {
  fromPage,
  pageLink,
  sessionLink,
  threadLink,
  wordsPlace,
} from "#frame/pages/card-links.mjs";
import { readPlace } from "#frame/pages/card-place.mjs";
import { statusBox } from "#frame/pages/card-status.mjs";
import { openNewItem, openStart } from "#frame/pages/start-popup.mjs";
import {
  cards,
  cardsEditable,
  cardState,
  cardTab,
  element,
  joinedInto,
  metaLine,
  openingTab,
  ownSession,
  setWorkTab,
  workGroups,
  workTab,
  workTabs,
} from "#frame/pages/work-model.mjs";
import { listedSession, unreadCards } from "#frame/sync/center-state.mjs";
import { adoptCards, cardKey, markSeen, seenCards } from "#frame/sync/seen.mjs";
import { allows, proposalState } from "#shared/proposal-state.mjs";

export {
  cardsEditable,
  cardState,
  cardTab,
  metaLine,
  openingTab,
  proposedCount,
  workGroups,
  workTab,
  workTabs,
} from "#frame/pages/work-model.mjs";

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

function sourceWhere(box, source) {
  if (source.page) {
    box.append(
      pageLink(fromPage(source.page), source.page.round, source.page.id),
    );
    return box;
  }
  if (source.thread) {
    box.append(threadLink("From a thread", source.thread));
    return box;
  }
  if (source.reviewer) {
    box.textContent = "You wrote this";
    return box;
  }
  return null;
}

function linkedWhere(box, { state, label, linked }) {
  if (state === "closed") {
    box.append(sessionLink("Done in its own session", linked));
    return box;
  }
  if (state === "linked") {
    if (label !== ownSession) box.append(`${ownSession} · `);
    box.append(sessionLink("Open", linked));
    return box;
  }
  if (state === "opening") {
    box.textContent = "Waiting for its session to start";
    return box;
  }
  return null;
}

// Running work started here has no line, because its state says where it
// runs. label is the word cardState() gives the card.
function cardWhere(card, label) {
  const state = proposalState(card);
  if (state === "running") return null;
  const box = element("span", "proposal-where");
  if (state === "joined") {
    const task = cards().find((item) => item.id === card.done.joined);
    box.textContent = `Joined ${task?.title ?? card.done.joined}`;
    box.title = box.textContent;
    return box;
  }
  if (card.done?.where) {
    box.textContent = card.done.where;
    box.title = `Done ${card.done.where}`;
    return box;
  }
  return (
    linkedWhere(box, { state, label, linked: card.started?.session }) ??
    sourceWhere(box, card.source)
  );
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
  if (shown) setWorkTab(cardTab(card));
  refreshWork(true);
  if (shown) land({ target: `proposal-${card.id}` });
  // In the search window's frame, the window's own list shows the card's state.
  if (embedded) window.parent.dispatchEvent(new Event("pair:card"));
  // poll() fetches the rest of what the action changed, such as the thread
  // that Open a new agent session starts.
  void callHook("poll");
}

function actionButton(className, label, run) {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", run);
  return node;
}

function actions(card) {
  const left = element("span", "proposal-foot-start");
  if (allows(card, "restore")) {
    left.append(
      actionButton("link-btn", "Restore", () => act(card, "restore")),
    );
  } else if (allows(card, "decline")) {
    left.append(
      actionButton("link-btn", "Decline", () => act(card, "decline")),
    );
  }
  const right = element("span", "proposal-actions");
  if (allows(card, "start")) {
    right.append(
      actionButton("btn primary proposal-start", "Start", () =>
        openStart(card, joinedInto(card), (result) => {
          actedOn = card.id;
          changed(result);
        }),
      ),
    );
  }
  return [left, right];
}

function appendStartedQuote(body, started) {
  if (!started) return;
  if (started.by === "words") {
    const lead = element("p", "proposal-lead", "Started from your words");
    const place = wordsPlace(started);
    if (place) lead.append(" ", place);
    body.append(lead);
  }
  const quoted = started.quote ?? started.message;
  if (quoted) body.append(element("p", "proposal-message", `“${quoted}”`));
}

function appendCardDetails(body, card) {
  if (card.attachments?.length) body.append(images(card));
  // cardElement() quotes the reviewer's words that started the card, or the
  // reviewer's message with Start, so the card shows everything the reviewer
  // approved.
  appendStartedQuote(body, card.started);
  if (card.withdrawn) {
    body.append(
      element(
        "p",
        "proposal-reason",
        `The agent's reason: ${card.withdrawn.reason}`,
      ),
    );
  }
  const joined = joinedInto(card);
  if (joined.length) body.append(joinedList(joined));
}

function cardFooter(card) {
  if (!cardsEditable()) return null;
  const buttons = actions(card);
  if (!buttons.some((side) => side.children.length)) return null;
  const foot = element("div", "proposal-foot");
  foot.append(...buttons);
  return foot;
}

function cardBody(card, { shown, fresh, stays }) {
  const head = element("p", "proposal-title");
  head.append(element("b", "", card.title));
  if (fresh) head.append(element("span", "page-new", "New"));
  const [state, tone] = cardState(card, shown);
  const body = element("div", "proposal-body");
  body.append(head, metaLine(state, tone, cardWhere(card, state)));
  // A finished card that stays on screen keeps its status box, and so its height.
  if (allows(card, "status") || (stays && card.started)) {
    body.append(statusBox(card));
  }
  body.append(element("p", "proposal-delivers", card.delivers));
  appendCardDetails(body, card);
  return body;
}

export function cardElement(card, options = {}) {
  const { shown = context(), fresh = false, stays = false } = options;
  const root = element("article", "proposal-card");
  root.dataset.proposalCard = card.id;
  // The comment control uses data-kind to name a chosen card.
  root.dataset.kind = "proposal";
  root.append(cardBody(card, { shown, fresh, stays }));
  const foot = cardFooter(card);
  if (foot) root.append(foot);
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
      if (shown.length && !embedded) {
        markSeen(
          session.sessionId,
          shown.map((entry) => entry.target.dataset.proposalCard),
        );
      }
    },
    { threshold: 0.5 },
  );
  for (const node of list.querySelectorAll("[data-proposal-card]")) {
    watcher.observe(node);
  }
}

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
  setWorkTab(id);
  refreshWork(true);
  $(`work-tab-${id}`)?.focus();
}

// The reviewer has already seen a card they wrote, so it gets no New label.
const openForm = () =>
  openNewItem((result, id) => {
    markSeen(session.sessionId, [id]);
    changed(result, id);
  });

const wiredWorkControls = new WeakSet();

function renderWork(groups, shown, seen) {
  const selected = workTab();
  const newButton = $("work-new");
  newButton.hidden = !cardsEditable();
  if (!wiredWorkControls.has(newButton)) {
    wiredWorkControls.add(newButton);
    newButton.addEventListener("click", openForm);
  }
  const tabBar = $("work-tabs");
  tabBar.replaceChildren(
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
      tab.addEventListener("click", () => selectTab(id));
      return tab;
    }),
  );
  if (!wiredWorkControls.has(tabBar)) {
    wiredWorkControls.add(tabBar);
    tabBar.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const index = workTabs.findIndex(({ id }) => id === workTab());
      selectTab(
        workTabs[(index + step + workTabs.length) % workTabs.length].id,
      );
    });
  }
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
          const node = cardElement(card, {
            shown,
            fresh: marked.has(card.id) && labelled(card),
            stays: staying.has(card.id),
          });
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
  root.replaceChildren(cardElement(card, { shown, fresh }));
}

function settleSelectedTab(groups) {
  const named = cardAt(openedAt);
  if (named) {
    setWorkTab(cardTab(named));
    openedAt = null;
    opening = false;
  } else if (opening && remote) {
    const kept = resumedWorkTab();
    setWorkTab(groups[kept] ? kept : openingTab(groups));
    opening = false;
  }
}

function updateStayingCards(groups, place) {
  if (!place) staying.clear();
  for (const id of place?.cards ?? []) staying.add(id);
  for (const card of groups[workTab()]) staying.delete(card.id);
}

function syncMountedProposals(seen) {
  for (const root of mounted.keys()) {
    if (root.isConnected) paintProposal(root, seen);
    else mounted.delete(root);
  }
}

function workDrawKey(shown, seen) {
  return JSON.stringify([
    cards(),
    linkedWaits(),
    [...shown.unread],
    workTab(),
    failure,
    cardsEditable(),
    remote?.current?.round,
    // The first session list brings the seen cards, so Work draws its New
    // labels then.
    Boolean(seen),
  ]);
}

function shouldRedrawWork(force, key) {
  // A redraw takes the thread cards out of the list, so the reply box the
  // reviewer is typing in would lose focus and the next keys would reach the
  // frame's shortcuts. The first poll after the reviewer leaves the box draws
  // the change.
  const typing = document.activeElement?.matches("#work-cards textarea");
  return force || (key !== drawnKey && !typing);
}

export function refreshWork(force = false) {
  if (remote && !embedded) adoptCards(session.sessionId, cards());
  const seen = seenCards();
  syncMountedProposals(seen);
  if ($("work-view").hidden) return placeThreads();
  const shown = context();
  const groups = workGroups(cards());
  settleSelectedTab(groups);
  const key = workDrawKey(shown, seen);
  const place = workTab() === drawnTab ? readPlace(actedOn) : null;
  if (shouldRedrawWork(force, key)) {
    drawnKey = key;
    updateStayingCards(groups, place);
    renderWork(groups, shown, seen);
  }
  placeThreads();
  place?.restore();
}
