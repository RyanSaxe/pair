import { flushPlace, placeIn, places, savePlaces } from "#frame/app/places.mjs";
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
  waiting,
  waitingView,
} from "#frame/app/view.mjs";
import { initializeChecklists } from "#frame/notes/controls.mjs";
import { indexPage, rebuildKnown } from "#frame/notes/notes.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import {
  displayedRound,
  redrawPage,
  show,
  updateNavigation,
} from "#frame/pages/pages.mjs";
import { updatePending } from "#frame/pages/pending.mjs";
import { refreshWork } from "#frame/pages/work.mjs";
import {
  renderSentFeedback,
  review,
  sentDraft,
  setRenderedFeedback,
  showSent,
} from "#frame/review/review.mjs";
import {
  clearSubmissionError,
  submissionInFlight,
} from "#frame/review/send.mjs";
import { renderHistory, renderRound } from "#frame/sync/activity-view.mjs";
import { renderRounds } from "#frame/sync/rounds-panel.mjs";

export let selectedTab = "current";
// sentByRound contains the submission of each past round that the Previous
// tab has shown.
export const sentByRound = new Map();
export const pageSets = new Map();
const recordLoads = new Map();
let pageSetLoading = null;
export let remote = null;
export function setRemote(status) {
  remote = status;
}
export let connected = false;
export let lastSubmission = null;
let lastSubmissionLoadedId = null;
async function fetchSubmission(round = null) {
  const response = await fetch(
    round
      ? `${base}/api/submission?round=${encodeURIComponent(round)}`
      : `${base}/api/submission`,
  );
  return response.ok ? (await response.json()).submission : undefined;
}
async function loadPastSubmission(round) {
  if (sentByRound.has(round) || lastSubmission?.round === round) return;
  const submission = await fetchSubmission(round);
  if (submission === undefined) return;
  sentByRound.set(round, submission);
  const onScreen =
    selectedTab === "past" && displayedRound === round && plan.round === round;
  const draft = onScreen ? state : views.get(round)?.draft;
  if (submission && draft && !draft.submitted) showSent(draft, submission);
  if (!onScreen) return;
  // show() redraws with keepScroll and the address's target, so the reader's
  // place, or a landing still under way, survives the redraw.
  const target = new URLSearchParams(location.search).get("target");
  if (!$("reading").hidden)
    show(page.id, target, { keepScroll: true, push: false });
  renderSentFeedback();
  renderHistory();
}
export async function loadSubmission() {
  const key =
    mode === "readonly" ? `round:${plan.round}` : remote?.latestSubmissionId;
  if (!key || key === lastSubmissionLoadedId) return;
  const submission = await fetchSubmission(
    mode === "readonly" ? plan.round : null,
  );
  if (submission === undefined) return;
  if (mode !== "readonly" && remote?.latestSubmissionId !== key) return;
  if (mode !== "readonly" && submission && submission.id !== key) return;
  lastSubmission = submission;
  lastSubmissionLoadedId = key;
  // A read-only round has no draft, so showSent fills its controls from the
  // submission.
  if (mode === "readonly" && submission) {
    showSent(state, submission);
    if (!$("reading").hidden)
      show(page.id, null, { keepScroll: true, push: false });
  }
  renderSentFeedback();
}
// A round counts as running from the reader's send, and while any round's
// pages are still being published. That includes round 1 and a build from
// the handoff line.
export const roundRunning = () =>
  (Boolean(submittedRound) && waiting()) || Boolean(remote?.openRound);
export const roundFinished = () =>
  Boolean(submittedRound) &&
  Boolean(remote?.current) &&
  !remote.openRound &&
  remote.current.round !== submittedRound &&
  remote.latestSubmissionRound === submittedRound;

/* loadPageRecord fetches a published page once, and a poll only updates
   the page's place in the list. */
export async function loadPageRecord(round, id) {
  const view = views.get(round);
  const manifest = pageSets.get(round);
  const slot = manifest?.pages.find((item) => item.id === id);
  if (!view || !slot?.version) return;
  const key = `${round}/${id}/${slot.version}`;
  if (recordLoads.has(key)) return recordLoads.get(key);
  const task = (async () => {
    const url = `${base}/api/page?round=${encodeURIComponent(round)}&id=${encodeURIComponent(id)}&version=${slot.version}`;
    const response = await fetch(url);
    if (!response.ok) throw Error("Could not load this page.");
    const record = await response.json();
    if (record.round !== round || record.page.id !== id)
      throw Error("Wrong page record.");
    const entry = view.pages.find((item) => item.id === id);
    if (id === "agreed") {
      // Agreed's source marks a plan round, so loadPageRecord sets
      // view.plan.plan when Agreed loads.
      view.plan.plan = record.plan === true;
      view.agreements = record.page.agreements;
      view.task = record.page.task || null;
      entry.loaded = true;
      entry.pending = false;
      if (plan.round === round && !showingWaiting()) useView(view);
    } else {
      let setup = null;
      if (record.page.jsText) {
        const blob = new Blob([record.page.jsText], {
          type: "text/javascript",
        });
        const moduleUrl = URL.createObjectURL(blob);
        try {
          ({ setup } = await import(moduleUrl));
          if (typeof setup !== "function")
            throw Error("Page setup is unavailable.");
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
      }
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
      if (setup)
        window.addEventListener("plan:page", ({ detail }) => {
          if (detail.page.id === id && detail.round === round)
            setup(detail.element, window.planUI);
        });
    }
    if (
      displayedRound === round &&
      id !== "agreed" &&
      plan.round === round &&
      page.id === id &&
      !$("reading").hidden
    ) {
      // The page on screen was a placeholder, so show() now scrolls to the
      // target of the landing that opened it, such as a notification's.
      const target = new URL(location.href).searchParams.get("target");
      show(id, target, { keepScroll: true, push: false, inPlace: true });
    }
    return record;
  })().catch((error) => {
    recordLoads.delete(key);
    if (
      displayedRound === round &&
      plan.round === round &&
      page.id === id &&
      !$("reading").hidden
    ) {
      $("page-content").innerHTML =
        `<div class="page-load-error" role="alert"><p>Could not load this page.</p><button class="btn" type="button">Retry</button></div>`;
      $("page-content").querySelector("button").onclick = () =>
        loadPageRecord(round, id).catch(() => {});
    }
    throw error;
  });
  recordLoads.set(key, task);
  return task;
}
export function pageStatus(item) {
  return item.status === "ready" || (!item.status && !item.pending)
    ? "complete"
    : item.status === "active"
      ? "active"
      : "queued";
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
    if (slot.state === "ready" && !entry.loaded && slot.id !== "agreed")
      entry.pending = true;
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
    if (
      selectedTab === "current" &&
      plan.round === round &&
      !showingWaiting()
    ) {
      updateNavigation();
      if (displayedRound === round) {
        const selected = manifest.pages.find((item) => item.id === page.id);
        if (selected?.state === "ready" && page.pending)
          void loadPageRecord(round, page.id).catch(() => {});
      }
    } else updateNavigation();
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
export async function openPast(round, { pageId = null, targetId = null } = {}) {
  const loaded = await loadPastView(round).catch(() => false);
  if (!loaded) {
    location.assign(`${base}/r/${encodeURIComponent(round)}`);
    return;
  }
  setPastRound(round);
  if (pageId) places[round] = { page: pageId, at: {} };
  switchTab("past", targetId, { showPage: true });
}
// Current's draft is the one set aside when the reader left Current, or
// else the saved draft.
export function currentDraft() {
  const view = views.get(remote?.current?.round);
  if (view?.draft) return view.draft;
  return savedDraft(remote.current.round);
}
// listedTab is the tab whose round the sidebar lists. A tab click lists that
// round's pages but leaves the page on screen, with its own round's draft
// and threads, until the reader picks a page from the list.
export let listedTab = "current";
const tabAvailable = (tab) =>
  tab === "current"
    ? currentShown() || submissionInFlight
    : tab !== "past" || pastAvailable();
const viewFor = (tab) => {
  const round = tab === "current" ? remote.current.round : pastRound;
  return tab === "current" && (waiting() || submissionInFlight)
    ? waitingView(round)
    : views.get(round);
};
export function listedPages() {
  if (listedTab === selectedTab)
    return {
      tab: selectedTab,
      round: plan.round,
      pages,
      waiting: showingWaiting(),
    };
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
  listedTab = tab;
  updateNavigation(true);
  review();
}
export function switchTab(tab, targetId = null, { showPage = true } = {}) {
  if (!tabAvailable(tab)) return;
  flushPlace();
  const round = tab === "current" ? remote.current.round : pastRound;
  const view = viewFor(tab);
  views.get(plan.round).draft = state;
  selectedTab = tab;
  listedTab = tab;
  useView(view);
  document.title = plan.title;
  // The waiting view has no draft of its own, so it uses the sent round's
  // draft.
  setState(
    views.get(round).draft ||
      (tab === "past" ? sentDraft(round) : savedDraft(round)),
  );
  rebuildKnown();
  if (tab === "current") initializeChecklists();
  setRenderedFeedback(null);
  updateNavigation(true);
  if (showPage) {
    setPage(pages[0]);
    const place = view.waiting
      ? null
      : placeIn(round, [...pages.map((item) => item.id), "feedback"]);
    show(place?.page || "agreed", targetId);
  } else savePlaces();
  if (tab === "past") void loadPastSubmission(round).catch(() => {});
  renderRounds();
}
export async function poll() {
  try {
    const response = await fetch(`${base}/api/status`);
    if (!response.ok) throw Error();
    const result = await response.json();
    if (result.sessionId !== session.sessionId) throw Error("Wrong session");
    remote = result;
    connected = true;
    if (editable && !submittedRound)
      setSubmittedRound(state.submitted?.round || remote.latestSubmissionRound);
    if (editable && !pastRound) setPastRound(submittedRound || null);
    // A read-only page stays on its own round. The next poll retries a
    // failed page-set fetch, and the failure does not mean that the hub is
    // unreachable.
    if (editable) {
      await syncPageSet().catch(() => {});
      await loadPastView(pastRound).catch(() => {});
    }
    // When Current's round was sent, in this browser or another, the
    // Previous tab shows it, and a reader on Work stays on Work.
    if (waiting() && !submissionInFlight) {
      setSubmittedRound(remote.current.round);
      if (selectedTab === "current" && !showingWaiting()) {
        setPastRound(submittedRound);
        const onWork = shownPage() === "work";
        switchTab("current", null, { showPage: !onWork });
        if (onWork) show("work", null, { keepScroll: true, push: false });
      }
    }
    // When the next round's Agreed arrives while Current waits, the frame
    // replaces the pending Agreed without moving the reader or the scroll
    // position.
    if (showingWaiting() && currentAvailable() && !submissionInFlight) {
      switchTab("current", null, { showPage: false });
      show(
        ["feedback", "work"].includes(shownPage()) ? shownPage() : "agreed",
        null,
        {
          keepScroll: true,
          push: false,
          inPlace: true,
        },
      );
    }
    void loadSubmission().catch(() => {});
    placeThreads();
    if (
      state.pending?.event?.id === remote.latestSubmissionId &&
      remote.latestSubmissionRound === plan.round &&
      state.submitted?.id !== remote.latestSubmissionId
    ) {
      markSent(state, remote.latestSubmissionId, new Date().toISOString());
      clearSubmissionError();
      persist();
    }
  } catch {
    connected = false;
  }
  renderRounds();
  updateNavigation();
  updatePending();
  renderRound();
  review();
  refreshWork();
  redrawPage();
}
