import { state } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import { submissionInFlight } from "#frame/review/send.mjs";
import { remote, selectedTab } from "#frame/sync/rounds.mjs";

export let session, base, online, mode, editable, hasFeedbackPage, query;
export let storageKey, placeKey, prefsPrefix;
export function useSession(config, name, url) {
  session = config;
  base = typeof session.base === "string" ? session.base : "";
  online = Boolean(session.sessionId) && /^https?:$/.test(url.protocol);
  /* The frame treats a closed session like an older round, from which
     nothing can be sent. */
  mode = session.home
    ? "home"
    : session.preview
      ? "preview"
      : session.readonly || session.closed
        ? "readonly"
        : "live";
  editable = mode === "live";
  // A read-only round has a Feedback page that lists what was sent on it.
  hasFeedbackPage = editable || mode === "readonly";
  query = url.searchParams;
  storageKey = `pair:${session.sessionId || "offline"}:${name}`;
  placeKey = `pair:place:${session.sessionId || "offline"}`;
  prefsPrefix = `pair:prefs:${session.sessionId || "offline"}:`;
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
const placeTitles = { overall: "Overall feedback", work: "Work" };
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
export const shownPage = () =>
  !$("work-view").hidden ? "work" : $("reading").hidden ? "feedback" : page.id;
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
// A note on a round whose feedback was sent can still start a thread,
// because the agent answers threads while it prepares the next round or
// builds. The hub accepts threads only on its current round, until the
// session is complete.
export const noteEditable = () =>
  feedbackEditable() ||
  (editable &&
    online &&
    remote?.stage !== "complete" &&
    remote?.current?.name === plan.name &&
    remote?.current?.round === plan.round);
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
