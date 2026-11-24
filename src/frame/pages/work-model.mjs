import { remote } from "#frame/app/state.mjs";
import { editable, online } from "#frame/app/view.mjs";
import { isClosed } from "#shared/lifecycle.mjs";
import { proposalState } from "#shared/proposal-state.mjs";

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

export const cards = () => remote?.proposals || [];
export const joinedInto = (card) =>
  cards().filter((item) => item.done?.joined === card.id);

// Start, Decline and Restore work only in the live session.
export const cardsEditable = () =>
  editable && online && Boolean(remote) && !isClosed(remote);
export const proposedCount = () => workGroups(cards()).proposed.length;

let selected = workTabs[0].id;
export const workTab = () => selected;
export function setWorkTab(tab) {
  selected = tab;
}

export const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const ownSession = "In its own session";
const finishedWords = {
  declined: "Declined",
  withdrawn: "Withdrawn",
  done: "Done",
  joined: "Done",
  closed: "Done",
};

function startedState(card, shown) {
  if (waits(card, shown)) return ["Waiting for you", "ok"];
  // Work started with Plan it first is in planning until the reviewer of its
  // session chooses Build it.
  if (card.started.planFirst && !card.started.built) {
    return card.started.where === "new-agent"
      ? ["Planning with a new agent", "accent"]
      : ["Planning in a sub-session", "accent"];
  }
  return [ownSession, "accent"];
}

export function cardState(card, shown) {
  const state = proposalState(card);
  if (finishedWords[state]) return [finishedWords[state], "muted"];
  if (shown.unread.has(card.id)) return ["Agent replied", "accent"];
  if (state === "proposed") return ["Proposed", "hollow"];
  if (state === "running") return ["Working here", "accent"];
  if (state === "opening") {
    return card.started.where === "new-agent"
      ? ["Opening a new agent session", "accent"]
      : ["Opening a sub-session", "accent"];
  }
  return startedState(card, shown);
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
