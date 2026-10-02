import { installEvents } from "#frame/app/events.mjs";
import {
  installPlaces,
  loadPlaces,
  placeIn,
  restoreScroll,
} from "#frame/app/places.mjs";
import { createPlanUI, installRegistry } from "#frame/app/registry.mjs";
import { emptyDraft, savedDraft, setState, state } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  agreedTask,
  agreements,
  editable,
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
import { installThreads } from "#frame/notes/threads.mjs";
import {
  installPages,
  narrow,
  placeNavigation,
  reveal,
  show,
} from "#frame/pages/pages.mjs";
import { startHome } from "#frame/pages/home.mjs";
import { installProgress, releaseChrome } from "#frame/pages/progress.mjs";
import { installRenderers, theme } from "#frame/pages/renderers.mjs";
import { review } from "#frame/review/review.mjs";
import { installSend } from "#frame/review/send.mjs";
import { renderRounds } from "#frame/sync/rounds-dialog.mjs";
import {
  installDraftSync,
  openPast,
  poll,
  selectedTab,
} from "#frame/sync/rounds.mjs";
import { installSessions, pollSessions } from "#frame/sync/sessions.mjs";

/* Start */
const planData = JSON.parse($("plan-data").textContent);
useSession(
  JSON.parse($("session-config").textContent),
  planData.name,
  new URL(location.href),
);
document.documentElement.dataset.mode = mode;
if (mode === "home") bootHome();
else bootRound();

/* A session with nothing published: the header, the session's title and
   the progress card. Component behaviors still register when the module
   script runs, so planUI exists here too. */
function bootHome() {
  useView({ plan: planData, agreements: [], task: null, pages: [] });
  installRenderers();
  installSessions();
  installProgress();
  installEvents();
  window.planUI = createPlanUI();
  document.title = plan.title;
  theme();
  startHome();
}

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
  if (editable) setPastRound(placeStore.past);
  // A reload after a send opens Current waiting for the next round, with the
  // sent round in the left tab.
  if (editable && state.submitted?.round === plan.round) {
    setSubmittedRound(plan.round);
    setPastRound(plan.round);
    useView(waitingView(plan.round));
  }
  setPage(pages[0]);
  // Handlers for the same event run in the order they were added, so the
  // parts install in this order: the note click on #page-content, for one,
  // runs before the click that chooses a block.
  installRenderers();
  installNotes();
  installSessions();
  installPlaces();
  installPages();
  installProgress();
  installNoteDialog();
  installThreads();
  installSend();
  installEvents();
  installControls();
  installBlocks();
  installRegistry();
  installDrawing();
  installDraftSync();
  window.planUI = createPlanUI();
  document.title = plan.title;
  narrow.addEventListener("change", placeNavigation);
  placeNavigation();
  if (editable) initializeChecklists();
  theme();
  renderRounds();
  /* The first page renders once every component has registered. Component
     behaviors run in the page's module script after this module, and the
     plan's script is a module of its own, so both run while the document is
     still loading and both are done by DOMContentLoaded. */
  function start() {
    // The waiting view carries the sent round's number, so the place saved
    // under that number is the sent round's, not the waiting view's. Like
    // switchTab(), the waiting view opens at Agreed.
    const place = showingWaiting()
      ? null
      : placeIn(plan.round, [
          ...pages.map((item) => item.id),
          ...(editable ? ["feedback"] : []),
        ]);
    const target = query.get("target");
    const asked = location.hash.slice(1);
    const opened = asked || target;
    show(asked || place?.page || "", target, {
      keepScroll: false,
      push: false,
    });
    // A notification of a reply names its thread's card, which the first
    // poll places, so the page scrolls to the card after that poll.
    const placedLater = target && !$(target);
    if (place?.top && !opened) restoreScroll(place.top);
    window.addEventListener("popstate", () => {
      const url = new URL(location.href);
      show(url.hash.slice(1) || pages[0].id, url.searchParams.get("target"), {
        push: false,
      });
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
        if (
          placedLater &&
          new URL(location.href).searchParams.get("target") === target
        )
          reveal(target);
        // A notification's link names its target. While Current waits, the
        // sent round's pages show only under Previous, so the link opens
        // there. A reload without a target returns to the past round that was
        // on screen.
        if (target && showingWaiting())
          void openPast(plan.round, {
            pageId: asked || "agreed",
            targetId: target,
          });
        else if (
          editable &&
          !target &&
          placeStore.tab === "past" &&
          selectedTab === "current"
        )
          if (placeStore.past) void openPast(placeStore.past);
        // The first status poll placed the thread cards, so the bell's first
        // count sees a reply already on screen.
        pollSessions();
        setInterval(pollSessions, 5000);
        // A page load shows the header and sidebar once they are drawn.
        requestAnimationFrame(() => releaseChrome());
      });
      setInterval(poll, 1500);
    } else review();
  }
  /* A module runs once the document is parsed, so readyState is "interactive"
     by this line and DOMContentLoaded is still ahead. That event is the point
     where every deferred script has run, the page's module script with its
     component blocks and the plan's module included. */
  if (document.readyState === "complete") start();
  else window.addEventListener("DOMContentLoaded", start, { once: true });
}
