import { remote, selectedTab, state } from "#frame/app/state.mjs";
import { $ } from "#frame/app/util.mjs";

export let session, base, online, mode, editable, hasFeedbackPage, query;
// In the search window, the frame shows one result and leaves the reader's
// place, history and what they've opened as they were.
export let embedded = false;
export let storageKey, placeKey, prefsPrefix;

function sessionMode(config) {
  /* The frame treats a closed session like an older round, from which
     nothing can be sent. */
  if (config.home) return "home";
  if (config.preview) return "preview";
  if (config.readonly || config.closed) return "readonly";
  return "live";
}

export function useSession(config, name, url) {
  session = config;
  base = typeof session.base === "string" ? session.base : "";
  embedded = Boolean(session.embedded);
  online = Boolean(session.sessionId) && /^https?:$/.test(url.protocol);
  mode = sessionMode(session);
  editable = mode === "live";
  // A read-only round has a What you sent page that lists what was sent on it.
  hasFeedbackPage = editable || mode === "readonly";
  query = url.searchParams;
  const scope = session.sessionId || "offline";
  storageKey = `pair:${scope}:${name}`;
  placeKey = `pair:place:${scope}`;
  prefsPrefix = `pair:prefs:${scope}:`;
}

export let plan, agreements, agreedTask, pages;
export function useView(view) {
  plan = view.plan;
  agreements = view.agreements;
  agreedTask = view.task || null;
  pages = view.pages;
}

// Agreed's source marks a plan round with "plan": true, and the hub copies
// that field into the round's data.
export const isPlanRound = (data = plan) => data?.plan === true;
const placeTitles = { overall: "Overall", work: "Work" };
export const topicTitle = (topic) =>
  pages.find((item) => item.id === topic)?.title ?? placeTitles[topic];

export let submittedRound = null;
export let pastRound = null;
export function setSubmittedRound(round) {
  submittedRound = round;
}
export function setPastRound(round) {
  pastRound = round;
}
export const views = new Map();

export let page;
export function setPage(next) {
  page = next;
}

export function shownPage() {
  if (!$("work-view").hidden) return "work";
  return $("reading").hidden ? "feedback" : page.id;
}

export const current = () =>
  selectedTab === "current" &&
  remote?.current?.name === plan.name &&
  remote?.current?.round === plan.round;

export const currentAvailable = () =>
  Boolean(
    remote?.current &&
    remote.current.round !== submittedRound &&
    views.has(remote.current.round),
  );

// waiting() is true when Current's round was sent, from this browser or
// another, and the agent has not published the next round. Before the first
// poll, waiting() reads this from the draft.
export const waiting = () =>
  editable &&
  (remote?.current
    ? remote.latestSubmissionRound === remote.current.round
    : state.submitted?.round === plan.round);

export const currentShown = () => currentAvailable() || waiting();

export function waitingView(round) {
  const sent = views.get(round).plan;
  return {
    plan: { ...sent, pages: [] },
    agreements: [],
    task: null,
    pages: [
      {
        id: "agreed",
        title: "Agreed so far",
        html: "",
        pending: true,
        working: true,
        waiting: true,
      },
    ],
    waiting: true,
  };
}

// The waiting view has the sent round's number, as the left tab's view does,
// so code that finds the view on screen by its round must check
// showingWaiting() first.
export const showingWaiting = () =>
  selectedTab === "current" && Boolean(pages[0]?.waiting);

// viewKey() identifies the view that show() puts on screen, for the checks
// that compare it with the tabs' views. The waiting view has its own key
// because it has the sent round's number.
export const viewKey = () =>
  showingWaiting() ? `${plan.round} waiting` : plan.round;

export const pastAvailable = () => Boolean(pastRound && views.has(pastRound));

// olderPast() is true when the left tab shows a round older than the last
// one, such as a round opened from the Rounds panel. The last round is the
// newest one before Current's, or Current's own round once its feedback is
// sent.
export function olderPast() {
  if (!pastRound || !remote?.current) return false;
  const last = waiting()
    ? remote.current.round
    : remote.rounds?.findLast((entry) => entry.round !== remote.current.round)
        ?.round;
  return pastRound !== last;
}
