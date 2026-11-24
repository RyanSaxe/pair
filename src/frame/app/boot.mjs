import { installDrawer } from "#frame/app/drawer.mjs";
import { installEdges } from "#frame/app/edges.mjs";
import { installEvents } from "#frame/app/events.mjs";
import { registerHooks } from "#frame/app/hooks.mjs";
import { installPlaces, loadPlaces, placeIn } from "#frame/app/places.mjs";
import { createPlanUI, installRegistry } from "#frame/app/registry.mjs";
import { installSidebar } from "#frame/app/sidebar.mjs";
import { selectedTab } from "#frame/app/state.mjs";
import { emptyDraft, savedDraft, setState, state } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  agreedTask,
  agreements,
  editable,
  embedded,
  mode,
  online,
  pages,
  plan,
  query,
  setPage,
  setPastRound,
  setSubmittedRound,
  showingWaiting,
  useSession,
  useView,
  views,
  waitingView,
} from "#frame/app/view.mjs";
import { installBlocks } from "#frame/notes/blocks.mjs";
import {
  initializeChecklists,
  installControls,
} from "#frame/notes/controls.mjs";
import { installDrawing } from "#frame/notes/drawing.mjs";
import {
  addNoteImage,
  installNoteDialog,
  threadNoteHasWords,
} from "#frame/notes/note-dialog.mjs";
import {
  installNotes,
  openAgentMessage,
  openNote,
  placeMarks,
} from "#frame/notes/notes.mjs";
import { findQuote, highlight } from "#frame/notes/quote.mjs";
import { installThreads, onCurrentAgreed } from "#frame/notes/threads.mjs";
import { startHome } from "#frame/pages/home.mjs";
import { installPages, renderFooter, show } from "#frame/pages/pages.mjs";
import { dropPictures, installProgress } from "#frame/pages/progress.mjs";
import { installRenderers, theme } from "#frame/pages/renderers.mjs";
import { installStart } from "#frame/pages/start-popup.mjs";
import {
  renderSentFeedback,
  review,
  shownSubmission,
} from "#frame/review/review.mjs";
import { installSendPopup, refreshSend } from "#frame/review/send-popup.mjs";
import {
  closeSentSend,
  installSend,
  sendFeedback,
} from "#frame/review/send.mjs";
import { embedShowing, installEmbed } from "#frame/search/embed.mjs";
import { installSearch } from "#frame/search/modal.mjs";
import { renderHistory } from "#frame/sync/activity-view.mjs";
import { openLine, renderCenter, toggleCenter } from "#frame/sync/center.mjs";
import { installDraftSync, queuePush, syncDraft } from "#frame/sync/draft.mjs";
import { installHubWatch } from "#frame/sync/hub-version.mjs";
import { installRounds, renderRounds } from "#frame/sync/rounds-panel.mjs";
import {
  currentDraft,
  listedPages,
  loadPageRecord,
  loadSubmission,
  openCurrent,
  openPast,
  poll,
  switchTab,
} from "#frame/sync/rounds.mjs";
import {
  installSessions,
  pollSessions,
  status,
  toggleSessions,
} from "#frame/sync/sessions.mjs";

registerHooks({
  addNoteImage,
  closeSentSend,
  currentDraft,
  dropPictures,
  listedPages,
  loadPageRecord,
  loadSubmission,
  openAgentMessage,
  openCurrent,
  openLine,
  openNote,
  openPast,
  placeMarks,
  poll,
  queuePush,
  refreshSend,
  renderCenter,
  renderFooter,
  renderHistory,
  renderSentFeedback,
  review,
  sendFeedback,
  show,
  shownSubmission,
  status,
  switchTab,
  threadNoteHasWords,
  toggleCenter,
  toggleSessions,
});

const planData = JSON.parse($("plan-data").textContent);
useSession(
  JSON.parse($("session-config").textContent),
  planData.name,
  new URL(location.href),
);
document.documentElement.dataset.mode = mode;
installHubWatch();
if (mode === "home") bootHome();
else bootRound();

/* The page's module script registers the component behaviors in a session
   with nothing published too, so bootHome() creates planUI as well. */
function bootHome() {
  useView({ plan: planData, agreements: [], task: null, pages: [] });
  installSidebar();
  installEdges();
  installRenderers();
  installSessions();
  installProgress();
  installEvents();
  installDrawer();
  window.planUI = createPlanUI();
  document.title = plan.title;
  theme();
  if (online) installSearch();
  startHome();
}

const EMBED_POLL_MS = 10000;

function installRoundModules() {
  // The browser runs the handlers for one event in the order they were added.
  // The order below matters: for example, the click handler that
  // installNotes() adds to #page-content must run before the one that
  // installBlocks() adds to choose a block.
  installSidebar();
  installEdges();
  installRenderers();
  installNotes();
  installSessions();
  installRounds();
  installPlaces();
  installPages();
  installProgress();
  installNoteDialog();
  installThreads();
  installStart();
  installSend();
  installSendPopup();
  installEvents();
  installDrawer();
  installControls();
  installBlocks();
  installRegistry();
  installDrawing();
  installDraftSync();
}

function initializeRoundState() {
  useView({
    plan: planData,
    agreements: planData.agreements || [],
    task: planData.task || null,
    pages: [
      { id: "agreed", title: "Agreed so far", html: "" },
      ...planData.pages,
    ],
  });
  views.set(plan.round, { plan, agreements, task: agreedTask, pages });
  setState(editable ? savedDraft(plan.round) : emptyDraft(plan.round));
  const placeStore = loadPlaces();
  if (editable && !embedded) setPastRound(placeStore.past);
  if (editable && state.submitted?.round === plan.round) {
    setSubmittedRound(plan.round);
    setPastRound(plan.round);
    useView(waitingView(plan.round));
  }
  setPage(pages[0]);
}

function bootRound() {
  initializeRoundState();
  installRoundModules();
  window.planUI = createPlanUI();
  document.title = plan.title;
  if (online && mode !== "preview" && !embedded) installSearch();
  if (editable) initializeChecklists();
  theme();
  renderRounds();
  /* The browser runs a module after it parses the document, so readyState is
     "interactive" here and DOMContentLoaded has not fired yet. The browser
     fires DOMContentLoaded after every deferred script has run, including
     the page's module script with its component blocks and the plan's
     module. */
  if (document.readyState === "complete") startRound();
  else window.addEventListener("DOMContentLoaded", startRound, { once: true });
}

function handlePopstate() {
  const url = new URL(location.href);
  const params = url.searchParams;
  const round = params.get("round");
  const pageId = url.hash.slice(1) || pages[0].id;
  const options = { push: false, match: params.get("match") };
  if (editable && round && round !== plan.round) {
    void openPast(round, {
      ...options,
      pageId,
      targetId: params.get("target"),
    });
    return;
  }
  if (editable && !round && selectedTab === "past") {
    switchTab("current", null, { showPage: false });
  }
  show(pageId, params.get("target"), options);
}

function highlightPreviewQuote() {
  if (mode !== "preview" || !query.get("quote")) return;
  const range = findQuote(
    query.get("quote"),
    query.get("target"),
    Number(query.get("occurrence")) || 1,
  );
  if (!range) return;
  highlight("plan-preview", [range]);
  range.startContainer.parentElement?.scrollIntoView({ block: "center" });
}

function targetBelongsToPastWaiting(target, asked) {
  return (
    Boolean(target) &&
    showingWaiting() &&
    asked !== "work" &&
    !onCurrentAgreed(target)
  );
}

function openRequestedPastRound({ askedRound, asked, target, match }) {
  // Only the address opens an older round, so a reload and Back return to
  // it and any other address opens Current. The waiting view has the sent
  // round's number, so an address that names that round asks for the left
  // tab. A notification's link puts its target in the address. While
  // Current waits, the frame shows the sent round's pages only under
  // Previous, so the target opens there, unless it is on Work, which every
  // round has, or on Current's progress card.
  const olderAsked =
    askedRound && (askedRound !== plan.round || (!target && showingWaiting()));
  if (editable && olderAsked) {
    void openPast(askedRound, {
      pageId: asked || "agreed",
      targetId: target,
      match,
      push: false,
    });
    return;
  }
  if (targetBelongsToPastWaiting(target, asked)) {
    void openPast(plan.round, {
      pageId: asked || "agreed",
      targetId: target,
    });
  }
}

function startPolling(initial) {
  poll().then(() => {
    void syncDraft();
    openRequestedPastRound(initial);
    // pollSessions() runs after the first status poll has placed the
    // thread cards, so the bell's first count includes a reply that is
    // already on screen.
    // The search window waits for this, because going to a result needs
    // the session's status.
    if (embedded) {
      installEmbed();
      return;
    }
    pollSessions();
    setInterval(pollSessions, 5000);
  });
  // A session's status can be large, and a preview needs it only now and
  // then, so the search window's frame asks less often, and only on screen.
  if (embedded) {
    setInterval(() => {
      if (embedShowing()) void poll().then(syncDraft);
    }, EMBED_POLL_MS);
  } else setInterval(() => poll().then(syncDraft), 1500);
}

/* startRound() renders the first page after every component has registered.
   The page's module script runs the component behaviors after this
   module, and the plan's script is a separate module. The browser runs
   both while the document is still loading, so both have run by
   DOMContentLoaded. */
function startRound() {
  // The waiting view has the sent round's number, so the place saved under
  // that number belongs to the sent round, not to the waiting view. The
  // waiting view opens at Agreed, as switchTab() does.
  const place = showingWaiting()
    ? null
    : placeIn(plan.round, [
        ...pages.map((item) => item.id),
        ...(editable ? ["feedback", "work"] : []),
      ]);
  const target = query.get("target");
  const asked = location.hash.slice(1);
  const match = query.get("match");
  const askedRound = query.get("round");
  show(asked || place?.page || "", target, {
    keepScroll: false,
    push: false,
    match,
  });
  window.addEventListener("popstate", handlePopstate);
  highlightPreviewQuote();
  if (online && mode !== "preview") {
    startPolling({ askedRound, asked, target, match });
  } else review();
}
