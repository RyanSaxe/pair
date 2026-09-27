import { state } from "#frame/app/store.mjs";
import { submissionInFlight } from "#frame/review/send.mjs";
import { remote, selectedTab } from "#frame/sync/rounds.mjs";

// The session this page belongs to and what it allows, read from the page
// before anything renders.
export let session, base, online, mode, editable, hasFeedbackPage, query;
// Browser storage is kept per session, and the draft per plan as well.
export let storageKey, placeKey, prefsPrefix;
export function useSession(config, name, url) {
  session = config;
  base = typeof session.base === "string" ? session.base : "";
  online = Boolean(session.sessionId) && /^https?:$/.test(url.protocol);
  /* A closed session reads like an older round: nothing can be sent from
     it. The strip below the header says which of the two it is. */
  mode = session.preview
    ? "preview"
    : session.readonly || session.closed
      ? "readonly"
      : "live";
  editable = mode === "live";
  // A read-only round keeps a Feedback page that lists what was sent on it.
  hasFeedbackPage = editable || mode === "readonly";
  query = url.searchParams;
  storageKey = `pair:${session.sessionId || "offline"}:${name}`;
  placeKey = `pair:place:${session.sessionId || "offline"}`;
  prefsPrefix = `pair:prefs:${session.sessionId || "offline"}:`;
}
// The round on screen: its plan, Agreed's entries and task, and its pages.
export let plan, agreements, agreedTask, pages;
export function useView(view) {
  plan = view.plan;
  agreements = view.agreements;
  agreedTask = view.task || null;
  pages = view.pages;
}
// The last round this reader submitted, which keeps Current disabled until
// the next one arrives, and the past round the left tab shows.
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
export const current = () =>
  selectedTab === "current" &&
  remote?.current?.name === plan.name &&
  remote?.current?.round === plan.round;
export const submittedCurrent = () =>
  editable &&
  (selectedTab === "past" ||
    state.submitted?.round === plan.round ||
    (current() && remote?.latestSubmissionRound === plan.round));
export const feedbackEditable = () =>
  editable &&
  selectedTab === "current" &&
  !submissionInFlight &&
  !submittedCurrent();
export const currentAvailable = () =>
  Boolean(
    remote?.current &&
    remote.current.round !== submittedRound &&
    views.has(remote.current.round),
  );
// Current's round was sent, here or in another browser, and the agent has
// not published the next one. Before the first poll, the draft says so.
export const waiting = () =>
  editable &&
  (remote?.current
    ? remote.latestSubmissionRound === remote.current.round
    : state.submitted?.round === plan.round);
export const currentShown = () => currentAvailable() || waiting();
// While Current waits, it holds one Agreed page that is still being
// prepared, above which the activity component shows. The next round's
// Agreed replaces it in place.
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
// The waiting view carries the sent round's number, which the left tab
// shows too, so code that finds the view on screen by its round checks
// this first.
export const showingWaiting = () =>
  selectedTab === "current" && Boolean(pages[0]?.waiting);
// What show() puts on screen, for the checks that compare it with the view
// the tabs hold. The waiting view gets a key of its own.
export const viewKey = () =>
  showingWaiting() ? `${plan.round} waiting` : plan.round;
export const pastAvailable = () => Boolean(pastRound && views.has(pastRound));
