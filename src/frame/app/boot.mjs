import { installEvents } from "#frame/app/events.mjs";
import { installPlaces, loadPlaces, placeIn } from "#frame/app/places.mjs";
import { createPlanUI, installRegistry } from "#frame/app/registry.mjs";
import { installSidebar } from "#frame/app/sidebar.mjs";
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
import { installNoteDialog } from "#frame/notes/note-dialog.mjs";
import { findQuote, highlight, installNotes } from "#frame/notes/notes.mjs";
import { installThreads, onCurrentAgreed } from "#frame/notes/threads.mjs";
import { installPages, show } from "#frame/pages/pages.mjs";
import { startHome } from "#frame/pages/home.mjs";
import { installProgress } from "#frame/pages/progress.mjs";
import { installStart } from "#frame/pages/start-popup.mjs";
import { installRenderers, theme } from "#frame/pages/renderers.mjs";
import { review } from "#frame/review/review.mjs";
import { installSend } from "#frame/review/send.mjs";
import { installSendPopup } from "#frame/review/send-popup.mjs";
import { installHubWatch } from "#frame/sync/hub-version.mjs";
import { installRounds, renderRounds } from "#frame/sync/rounds-panel.mjs";
import { openPast, poll, selectedTab, switchTab } from "#frame/sync/rounds.mjs";
import { installDraftSync, syncDraft } from "#frame/sync/draft.mjs";
import { installSessions, pollSessions } from "#frame/sync/sessions.mjs";
import { embedShowing, installEmbed } from "#frame/search/embed.mjs";
import { installSearch } from "#frame/search/modal.mjs";

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
  installRenderers();
  installSessions();
  installProgress();
  installEvents();
  window.planUI = createPlanUI();
  document.title = plan.title;
  theme();
  if (online) installSearch();
  startHome();
}

const EMBED_POLL_MS = 10000;
function bootRound() {
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
  // The browser runs the handlers for one event in the order they were added.
  // The order below matters: for example, the click handler that
  // installNotes() adds to #page-content must run before the one that
  // installBlocks() adds to choose a block.
  installSidebar();
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
  installControls();
  installBlocks();
  installRegistry();
  installDrawing();
  installDraftSync();
  window.planUI = createPlanUI();
  document.title = plan.title;
  if (online && mode !== "preview" && !embedded) installSearch();
  if (editable) initializeChecklists();
  theme();
  renderRounds();
  /* start() renders the first page after every component has registered.
     The page's module script runs the component behaviors after this
     module, and the plan's script is a separate module. The browser runs
     both while the document is still loading, so both have run by
     DOMContentLoaded. */
  function start() {
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
    window.addEventListener("popstate", () => {
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
      if (editable && !round && selectedTab === "past")
        switchTab("current", null, { showPage: false });
      show(pageId, params.get("target"), options);
    });
    if (mode === "preview" && query.get("quote")) {
      const range = findQuote(
        query.get("quote"),
        query.get("target"),
        Number(query.get("occurrence")) || 1,
      );
      if (range) {
        highlight("plan-preview", [range]);
        range.startContainer.parentElement?.scrollIntoView({ block: "center" });
      }
    }
    if (online && mode !== "preview") {
      poll().then(() => {
        void syncDraft();
        // A notification's link puts its target in the address. While Current
        // waits, the frame shows the sent round's pages only under Previous,
        // so the target opens there, unless it is on Work, which every round
        // has, or on Current's progress card. A reload without a target
        // returns to the past round that was on screen.
        if (editable && askedRound && askedRound !== plan.round)
          void openPast(askedRound, {
            pageId: asked || "agreed",
            targetId: target,
            match,
            push: false,
          });
        else if (
          target &&
          showingWaiting() &&
          asked !== "work" &&
          !onCurrentAgreed(target)
        )
          void openPast(plan.round, {
            pageId: asked || "agreed",
            targetId: target,
          });
        else if (
          editable &&
          !embedded &&
          !target &&
          placeStore.tab === "past" &&
          selectedTab === "current"
        )
          if (placeStore.past) void openPast(placeStore.past);
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
      if (embedded)
        setInterval(() => {
          if (embedShowing()) void poll().then(syncDraft);
        }, EMBED_POLL_MS);
      else setInterval(() => poll().then(syncDraft), 1500);
    } else review();
  }
  /* The browser runs a module after it parses the document, so readyState is
     "interactive" here and DOMContentLoaded has not fired yet. The browser
     fires DOMContentLoaded after every deferred script has run, including
     the page's module script with its component blocks and the plan's
     module. */
  if (document.readyState === "complete") start();
  else window.addEventListener("DOMContentLoaded", start, { once: true });
}
