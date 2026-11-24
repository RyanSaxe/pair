import { flushPlace, placeIn, places, savePlaces } from "#frame/app/places.mjs";
import {
  clearSubmissionError,
  connected,
  displayedRound,
  lastSubmission,
  listedTab,
  pageSets,
  remote,
  selectedTab,
  sentByRound,
  setConnected,
  setLastSubmission,
  setListedTab,
  setRemote,
  setSelectedTab,
} from "#frame/app/state.mjs";
import {
  markSent,
  persist,
  savedDraft,
  setState,
  state,
} from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  base,
  currentAvailable,
  currentShown,
  editable,
  embedded,
  mode,
  page,
  pages,
  pastAvailable,
  pastRound,
  plan,
  session,
  setPage,
  setPastRound,
  setSubmittedRound,
  showingWaiting,
  shownPage,
  submittedRound,
  useView,
  views,
  waitingView,
} from "#frame/app/view.mjs";
import { initializeChecklists } from "#frame/notes/controls.mjs";
import { indexPage, rebuildKnown } from "#frame/notes/known.mjs";
import { onCurrentAgreed, placeThreads } from "#frame/notes/threads.mjs";
import { redrawPage, show, updateNavigation } from "#frame/pages/pages.mjs";
import { updatePending } from "#frame/pages/pending.mjs";
import { refreshWork } from "#frame/pages/work.mjs";
import {
  renderSentFeedback,
  review,
  sentDraft,
  setRenderedFeedback,
  showSent,
} from "#frame/review/review.mjs";
import { sendState } from "#frame/review/send-state.mjs";
import { renderHistory, renderRound } from "#frame/sync/activity-view.mjs";
import { noticeHub } from "#frame/sync/hub-version.mjs";
import { renderRounds } from "#frame/sync/rounds-panel.mjs";
import { fetchStatus, statusLoading } from "#frame/sync/status.mjs";

export {
  connected,
  lastSubmission,
  listedTab,
  pageSets,
  pageStatus,
  remote,
  selectedTab,
  sentByRound,
  setRemote,
} from "#frame/app/state.mjs";

const recordLoads = new Map();
let pageSetLoading = null;
let lastSubmissionLoadedId = null;

async function fetchSubmission(round = null) {
  const response = await fetch(
    round
      ? `${base}/api/submission?round=${encodeURIComponent(round)}`
      : `${base}/api/submission`,
  );
  return response.ok ? (await response.json()).submission : undefined;
}

function isPastRoundOnScreen(round) {
  return (
    selectedTab === "past" && displayedRound === round && plan.round === round
  );
}

function redrawPastSubmissionOnScreen() {
  // show() redraws with keepScroll and the address's target, so the reader's
  // place, or a landing still under way, survives the redraw.
  const target = new URLSearchParams(location.search).get("target");
  if (!$("reading").hidden) {
    show(page.id, target, { keepScroll: true, push: false });
  }
  renderSentFeedback();
  renderHistory();
}

function fillPastDraft(round, onScreen, submission) {
  const draft = onScreen ? state : views.get(round)?.draft;
  if (submission && draft && !draft.submitted) showSent(draft, submission);
}

async function loadPastSubmission(round) {
  if (sentByRound.has(round) || lastSubmission?.round === round) return;
  const submission = await fetchSubmission(round);
  if (submission === undefined) return;
  sentByRound.set(round, submission);
  const onScreen = isPastRoundOnScreen(round);
  fillPastDraft(round, onScreen, submission);
  if (onScreen) redrawPastSubmissionOnScreen();
}

function submissionMatchesCurrentKey(key, submission) {
  if (mode === "readonly") return true;
  if (remote?.latestSubmissionId !== key) return false;
  return !submission || submission.id === key;
}

function applyReadonlySubmission(submission) {
  // A read-only round has no draft, so showSent fills its controls from the
  // submission.
  if (mode !== "readonly" || !submission) return;
  showSent(state, submission);
  if (!$("reading").hidden) {
    show(page.id, null, { keepScroll: true, push: false });
  }
}

export async function loadSubmission() {
  const readonly = mode === "readonly";
  const key = readonly ? `round:${plan.round}` : remote?.latestSubmissionId;
  if (!key || key === lastSubmissionLoadedId) return;
  const submission = await fetchSubmission(readonly ? plan.round : null);
  if (submission === undefined) return;
  if (!submissionMatchesCurrentKey(key, submission)) return;
  setLastSubmission(submission);
  lastSubmissionLoadedId = key;
  applyReadonlySubmission(submission);
  renderSentFeedback();
}

async function importPageSetup(jsText) {
  if (!jsText) return null;
  const blob = new Blob([jsText], { type: "text/javascript" });
  const moduleUrl = URL.createObjectURL(blob);
  try {
    const { setup } = await import(moduleUrl);
    if (typeof setup !== "function") {
      throw Error("Page setup is unavailable.");
    }
    return setup;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

async function applyContentPageRecord({ view, entry, record, round, id }) {
  const setup = await importPageSetup(record.page.jsText);
  entry.html = record.page.html;
  entry.loaded = true;
  entry.pending = false;
  indexPage(entry);
  view.plan.prototypes ||= [];
  view.plan.prototypes.push(...(record.page.prototypes || []));
  if (record.page.cssText) {
    const style = document.createElement("style");
    style.textContent = `@layer plan { @scope (#page-content[data-page-id="${id}"][data-round="${round}"]) { ${record.page.cssText} } }`;
    document.head.append(style);
  }
  if (setup) {
    window.addEventListener("plan:page", ({ detail }) => {
      if (detail.page.id === id && detail.round === round) {
        setup(detail.element, window.planUI);
      }
    });
  }
}

function applyAgreedRecord({ view, entry, record, round }) {
  // Agreed's source marks a plan round, so loadPageRecord sets
  // view.plan.plan when Agreed loads.
  view.plan.plan = record.plan === true;
  view.agreements = record.page.agreements;
  view.task = record.page.task || null;
  entry.loaded = true;
  entry.pending = false;
  if (plan.round === round && !showingWaiting()) useView(view);
}

function isShowingPage(round, id) {
  return (
    displayedRound === round &&
    plan.round === round &&
    page.id === id &&
    !$("reading").hidden
  );
}

function renderPageLoadError(round, id) {
  $("page-content").innerHTML =
    `<div class="page-load-error" role="alert"><p>Could not load this page.</p><button class="btn" type="button">Retry</button></div>`;
  $("page-content")
    .querySelector("button")
    .addEventListener("click", () => loadPageRecord(round, id).catch(() => {}));
}

async function fetchAndApplyPageRecord({ view, slot, round, id }) {
  const url = `${base}/api/page?round=${encodeURIComponent(round)}&id=${encodeURIComponent(id)}&version=${slot.version}`;
  const response = await fetch(url);
  if (!response.ok) throw Error("Could not load this page.");
  const record = await response.json();
  if (record.round !== round || record.page.id !== id) {
    throw Error("Wrong page record.");
  }
  const entry = view.pages.find((item) => item.id === id);
  if (id === "agreed") applyAgreedRecord({ view, entry, record, round });
  else await applyContentPageRecord({ view, entry, record, round, id });
  if (id !== "agreed" && isShowingPage(round, id)) {
    // The page on screen was a placeholder, so show() now scrolls to the
    // target of the landing that opened it, such as a notification's.
    const target = new URL(location.href).searchParams.get("target");
    show(id, target, { keepScroll: true, push: false, inPlace: true });
  }
  return record;
}

/* loadPageRecord fetches a published page once, and a poll only updates
   the page's place in the list. */
export async function loadPageRecord(round, id) {
  const view = views.get(round);
  const manifest = pageSets.get(round);
  const slot = manifest?.pages.find((item) => item.id === id);
  if (!view || !slot?.version) return;
  const key = `${round}/${id}/${slot.version}`;
  if (recordLoads.has(key)) return recordLoads.get(key);
  const task = fetchAndApplyPageRecord({ view, slot, round, id }).catch(
    (error) => {
      recordLoads.delete(key);
      if (isShowingPage(round, id)) renderPageLoadError(round, id);
      throw error;
    },
  );
  recordLoads.set(key, task);
  return task;
}

function reconcilePages(view, manifest) {
  for (const slot of manifest.pages) {
    let entry = view.pages.find((item) => item.id === slot.id);
    if (!entry) {
      entry = { id: slot.id, title: slot.title, html: "", pending: true };
      view.pages.push(entry);
    }
    if (entry.loaded === undefined) entry.loaded = !entry.pending;
    entry.title = slot.title;
    entry.status = slot.state;
    entry.working = slot.state === "active";
    if (slot.state !== "ready") entry.pending = true;
    if (slot.state === "ready" && !entry.loaded && slot.id !== "agreed") {
      entry.pending = true;
    }
  }
  view.pages = manifest.pages.map((slot) =>
    view.pages.find((item) => item.id === slot.id),
  );
  view.plan.pages = view.pages.filter((item) => item.id !== "agreed");
  if (plan.round === view.plan.round && !showingWaiting()) useView(view);
}

function emptyView(round, { name, title }) {
  const view = {
    plan: { name, round, title, pages: [] },
    agreements: [],
    pages: [],
  };
  views.set(round, view);
  return view;
}

// When Agreed fails to load, loadPageSet restores the round's previous
// entry in pageSets.
async function loadPageSet(round, viewFor, failure) {
  const response = await fetch(
    `${base}/api/page-set?round=${encodeURIComponent(round)}`,
  );
  if (!response.ok) throw Error(failure);
  const manifest = await response.json();
  const view = viewFor();
  const previous = pageSets.get(round);
  pageSets.set(round, manifest);
  reconcilePages(view, manifest);
  try {
    await loadPageRecord(round, "agreed");
  } catch (error) {
    if (previous) pageSets.set(round, previous);
    else pageSets.delete(round);
    throw error;
  }
  return manifest;
}

// The search window's frame starts with no pages, so it reads their list first.
export const ensurePageSet = () =>
  pageSets.has(plan.round)
    ? Promise.resolve()
    : loadPageSet(
        plan.round,
        () => views.get(plan.round),
        "Could not load page list.",
      );

async function syncPageSet() {
  const round = remote?.current?.round;
  if (!round || !remote.pageSetGeneration) return;
  if (pageSetLoading) return pageSetLoading;
  const previous = pageSets.get(round);
  if (previous?.generation === remote.pageSetGeneration) return;
  pageSetLoading = (async () => {
    const manifest = await loadPageSet(
      round,
      () => views.get(round) || emptyView(round, remote.current),
      "Could not load page list.",
    );
    updateNavigation();
    if (
      selectedTab === "current" &&
      plan.round === round &&
      !showingWaiting() &&
      displayedRound === round
    ) {
      const selected = manifest.pages.find((item) => item.id === page.id);
      if (selected?.state === "ready" && page.pending) {
        void loadPageRecord(round, page.id).catch(() => {});
      }
    }
  })().finally(() => {
    pageSetLoading = null;
  });
  return pageSetLoading;
}

const pastLoads = new Map();
function loadPastView(round) {
  if (!round) return Promise.resolve(false);
  if (views.has(round)) return Promise.resolve(true);
  if (pastLoads.has(round)) return pastLoads.get(round);
  const task = (async () => {
    try {
      await loadPageSet(
        round,
        () => {
          const entry = remote?.rounds?.find((item) => item.round === round);
          return emptyView(round, {
            name: entry?.name || remote.current.name,
            title: entry?.title || remote.current.title,
          });
        },
        "Could not load that round's pages.",
      );
    } catch (error) {
      views.delete(round);
      throw error;
    }
    updateNavigation();
    return true;
  })().finally(() => {
    pastLoads.delete(round);
  });
  pastLoads.set(round, task);
  return task;
}

function navigateToPastRound(round, { pageId, targetId, match }) {
  const address = new URLSearchParams();
  if (targetId) address.set("target", targetId);
  if (match) address.set("match", match);
  const query = address.size ? `?${address}` : "";
  const hash = pageId ? `#${encodeURIComponent(pageId)}` : "";
  const older = `${base}/${embedded ? "embed" : "r"}/${encodeURIComponent(round)}${query}${hash}`;
  if (embedded) location.replace(older);
  else location.assign(older);
}

export async function openPast(
  round,
  { pageId = null, targetId = null, match = null, push = true } = {},
) {
  const loaded = await loadPastView(round).catch(() => false);
  if (!loaded) {
    navigateToPastRound(round, { pageId, targetId, match });
    return;
  }
  setPastRound(round);
  if (pageId) places[round] = { page: pageId, at: {} };
  switchTab("past", targetId, { showPage: true, match, push });
}

// From an older round's tab, a result in the current round moves back with no
// page load.
export function openCurrent({ pageId, targetId, match }) {
  places[remote.current.round] = { page: pageId, at: {} };
  switchTab("current", targetId, { showPage: true, match });
}

// Current's draft is the one set aside when the reader left Current, or
// else the saved draft.
export function currentDraft() {
  const view = views.get(remote?.current?.round);
  if (view?.draft) return view.draft;
  return savedDraft(remote.current.round);
}

const tabAvailable = (tab) =>
  tab === "current"
    ? currentShown() || sendState() === "sending"
    : tab !== "past" || pastAvailable();

const viewFor = (tab) => {
  const round = tab === "current" ? remote.current.round : pastRound;
  return tab === "current" && ["sending", "waiting"].includes(sendState())
    ? waitingView(round)
    : views.get(round);
};

export function listedPages() {
  if (listedTab === selectedTab) {
    return {
      tab: selectedTab,
      round: plan.round,
      pages,
      waiting: showingWaiting(),
    };
  }
  const view = viewFor(listedTab);
  return {
    tab: listedTab,
    round: view.plan.round,
    pages: view.pages,
    waiting: listedTab === "current" && Boolean(view.pages[0]?.waiting),
  };
}

export function listTab(tab) {
  if (!tabAvailable(tab)) return;
  setListedTab(tab);
  updateNavigation(true);
  review();
}

function showSwitchedTab({ view, round, targetId, match, push }) {
  setPage(pages[0]);
  const place = view.waiting
    ? null
    : placeIn(round, [...pages.map((item) => item.id), "feedback"]);
  show(place?.page || "agreed", targetId, { match, push });
}

function draftForTab(tab, round) {
  // The waiting view has no draft of its own, so it uses the sent round's
  // draft.
  return (
    views.get(round).draft ||
    (tab === "past" ? sentDraft(round) : savedDraft(round))
  );
}

function activateTabView(tab, round, view) {
  views.get(plan.round).draft = state;
  setSelectedTab(tab);
  setListedTab(tab);
  useView(view);
  document.title = plan.title;
  setState(draftForTab(tab, round));
  rebuildKnown();
  if (tab === "current") initializeChecklists();
  setRenderedFeedback(null);
  updateNavigation(true);
}

export function switchTab(tab, targetId = null, options = {}) {
  const { showPage = true, match = null, push = true } = options;
  if (!tabAvailable(tab)) return;
  flushPlace();
  const round = tab === "current" ? remote.current.round : pastRound;
  const view = viewFor(tab);
  activateTabView(tab, round, view);
  if (showPage) showSwitchedTab({ view, round, targetId, match, push });
  else savePlaces();
  if (tab === "past") void loadPastSubmission(round).catch(() => {});
  renderRounds();
}

async function enterWaitingViewIfNeeded() {
  if (sendState() !== "waiting") return;
  setSubmittedRound(remote.current.round);
  if (selectedTab !== "current" || showingWaiting()) return;
  setPastRound(submittedRound);
  const onWork = shownPage() === "work";
  const address = new URLSearchParams(location.search);
  const target = address.get("target");
  const match = address.get("match");
  if (!onWork && (target || match) && !onCurrentAgreed(target)) {
    await openPast(submittedRound, {
      pageId: shownPage(),
      targetId: target,
      match,
      push: false,
    });
    return;
  }
  switchTab("current", null, { showPage: !onWork });
  if (onWork) {
    show("work", null, { keepScroll: true, push: false, inPlace: true });
  }
}

function exitWaitingViewIfReady() {
  // When the next round's Agreed arrives while Current waits, the frame
  // replaces the pending Agreed without moving the reader or the scroll
  // position.
  if (!showingWaiting() || !currentAvailable() || sendState() === "sending") {
    return;
  }
  switchTab("current", null, { showPage: false });
  const destination = ["feedback", "work"].includes(shownPage())
    ? shownPage()
    : "agreed";
  show(destination, null, { keepScroll: true, push: false, inPlace: true });
}

function reconcilePendingSubmission() {
  if (
    state.pending?.event?.id !== remote.latestSubmissionId ||
    remote.latestSubmissionRound !== plan.round ||
    state.submitted?.id === remote.latestSubmissionId
  ) {
    return;
  }
  markSent(state, remote.latestSubmissionId, new Date().toISOString());
  clearSubmissionError();
  persist();
}

async function syncEditableViews() {
  if (!editable) return;
  if (!submittedRound) {
    setSubmittedRound(state.submitted?.round || remote.latestSubmissionRound);
  }
  if (!pastRound) setPastRound(submittedRound || null);
  // A read-only page stays on its own round. The next poll retries a
  // failed page-set fetch, and the failure does not mean that the hub is
  // unreachable.
  await syncPageSet().catch(() => {});
  await loadPastView(pastRound).catch(() => {});
}

async function applyPollResult(result) {
  if (result.sessionId !== session.sessionId) throw Error("Wrong session");
  setRemote(result);
  setConnected(true);
  await syncEditableViews();
  // When Current's round was sent, in this browser or another, the
  // Previous tab shows it, and a reader on Work stays on Work. A place the
  // reader opened from a result or a link stays open too, under Previous, as
  // it would have opened had this poll come first.
  await enterWaitingViewIfNeeded();
  exitWaitingViewIfReady();
  void loadSubmission().catch(() => {});
  // On Work, refreshWork() places the threads, and it keeps the reader's place
  // while it does.
  if (shownPage() !== "work") placeThreads();
  reconcilePendingSubmission();
}

export async function poll() {
  if (statusLoading) return;
  try {
    await applyPollResult(await fetchStatus());
  } catch {
    setConnected(false);
  }
  renderRounds();
  updateNavigation();
  updatePending();
  renderRound();
  review();
  refreshWork();
  redrawPage();
  if (connected) noticeHub(remote.hubVersion);
}
