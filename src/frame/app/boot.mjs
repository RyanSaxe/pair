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
import { findText, highlight, installNotes } from "#frame/notes/notes.mjs";
import {
  installPages,
  narrow,
  placeNavigation,
  show,
} from "#frame/pages/pages.mjs";
import { installRenderers, theme } from "#frame/pages/renderers.mjs";
import { review } from "#frame/review/review.mjs";
import { installSend } from "#frame/review/send.mjs";
import { renderRounds } from "#frame/sync/rounds-dialog.mjs";
import { openPast, poll, selectedTab } from "#frame/sync/rounds.mjs";
import { installSessions, pollSessions } from "#frame/sync/sessions.mjs";

/* Start */
const planData = JSON.parse($("plan-data").textContent);
useSession(
  JSON.parse($("session-config").textContent),
  planData.name,
  new URL(location.href),
);
document.documentElement.dataset.mode = mode;
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
installNoteDialog();
installSend();
installEvents();
installControls();
installBlocks();
installRegistry();
installDrawing();
window.planUI = createPlanUI();
document.title = plan.title;
narrow.addEventListener("change", placeNavigation);
placeNavigation();
if (editable) initializeChecklists();
theme();
renderRounds();
/* The first page renders once every component has registered. Component
   behaviors are bundled after this file and the plan's script is a module
   of its own, so both run while the document is still loading and both are
   done by DOMContentLoaded. */
function start() {
  const place = placeIn(plan.round, [
    ...pages.map((item) => item.id),
    ...(editable ? ["feedback"] : []),
  ]);
  const opened = location.hash.slice(1) || query.get("target");
  show(location.hash.slice(1) || place?.page || "", query.get("target"), {
    keepScroll: false,
    push: false,
  });
  if (place?.top && !opened) restoreScroll(place.top);
  window.addEventListener("popstate", () => {
    const url = new URL(location.href);
    show(url.hash.slice(1) || pages[0].id, url.searchParams.get("target"), {
      push: false,
    });
  });
  if (mode === "preview" && query.get("quote")) {
    const range = findText($("page-content"), query.get("quote"));
    if (range) {
      highlight("plan-preview", [range]);
      range.startContainer.parentElement?.scrollIntoView({ block: "center" });
    }
  }
  if (online && mode !== "preview") {
    // A reload returns to the past round that was on screen.
    poll().then(() => {
      if (editable && placeStore.tab === "past" && selectedTab === "current")
        if (placeStore.past) void openPast(placeStore.past);
    });
    setInterval(poll, 1500);
    pollSessions();
    setInterval(pollSessions, 5000);
  } else review();
}
/* A module runs once the document is parsed, so readyState is "interactive"
   by this line and DOMContentLoaded is still ahead. That event is the point
   where every deferred script has run, this module's component blocks and
   the plan's module included. */
if (document.readyState === "complete") start();
else window.addEventListener("DOMContentLoaded", start, { once: true });
