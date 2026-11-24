import { enhance } from "#frame/app/components.mjs";
import { callHook } from "#frame/app/hooks.mjs";
import {
  flushPlace,
  land,
  placeOnScreen,
  savedPlace,
} from "#frame/app/places.mjs";
import { openSidebar } from "#frame/app/sidebar.mjs";
import {
  displayedRound,
  pageStatus,
  selectedTab,
  setDisplayedRound,
} from "#frame/app/state.mjs";
import { inUse, pageIndicator, separator, tag } from "#frame/app/ui.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  current,
  currentShown,
  editable,
  embedded,
  hasFeedbackPage,
  isPlanRound,
  olderPast,
  online,
  page,
  pages,
  pastAvailable,
  pastRound,
  plan,
  session,
  setPage,
  showingWaiting,
  shownPage,
  submittedRound,
  viewKey,
} from "#frame/app/view.mjs";
import { chooseBlock } from "#frame/notes/blocks.mjs";
import {
  pageTargets,
  restoreAnswers,
  restoreChoices,
} from "#frame/notes/controls.mjs";
import { markMatch, matchWords, setMatch } from "#frame/notes/match.mjs";
import { countNotes, markNotes, placeMarks } from "#frame/notes/notes.mjs";
import { clearHighlight } from "#frame/notes/quote.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import { renderAgreements } from "#frame/pages/agreed.mjs";
import { pendingPage, updatePending } from "#frame/pages/pending.mjs";
import { arrived, beginMove } from "#frame/pages/progress.mjs";
import { disposeRenderers, renders } from "#frame/pages/renderers.mjs";
import { openWork } from "#frame/pages/work.mjs";
import { proposedCount } from "#frame/pages/work-model.mjs";
import { renderSentPageComments, review } from "#frame/review/review.mjs";
import { sendState } from "#frame/review/send-state.mjs";
import { markOpened, openedPages, pageKey } from "#frame/sync/opened.mjs";
import { closeMenus } from "#frame/sync/rounds-panel.mjs";

/* whenDrawn() keeps a page hidden, with its layout in place, until its
   diagrams and formulas have drawn, so nothing on it moves once it appears.
   A setup that never settles delays the page by at most DRAW_LIMIT_MS. Each
   call increments showing, so the wait of an older page never reveals a
   newer page early. */
const DRAW_LIMIT_MS = 10000;
let showing = 0;

function whenDrawn(drawing, then) {
  const generation = ++showing;
  const content = $("page-content");
  if (!drawing) {
    delete content.dataset.drawing;
    then();
    return;
  }
  content.dataset.drawing = "";
  let timer;
  Promise.race([
    drawing,
    new Promise((resolve) => (timer = setTimeout(resolve, DRAW_LIMIT_MS))),
  ]).then(() => {
    clearTimeout(timer);
    if (generation !== showing) return;
    delete content.dataset.drawing;
    then();
  });
}

function visiblePageId() {
  if (displayedRound !== viewKey()) return null;
  return shownPage();
}

// Every round of a session that the hub serves has Work.
const hasWork = () => online && hasFeedbackPage;

function populatePageBody() {
  $("page-content").dataset.pageId = page.id;
  $("page-content").dataset.round = plan.round;
  $("page-content").innerHTML = page.pending ? pendingPage : page.html;
  if (page.pending) {
    updatePending();
    return null;
  }
  pageTargets($("page-content"), page.id);
  if (page.id === "agreed" && !page.waiting) return renderAgreements();
  restoreChoices();
  restoreAnswers();
  markNotes();
  return enhance($("page-content"));
}

function renderReadingPage(id) {
  clearHighlight("plan-note");
  setPage(pages.find((item) => item.id === id) || pages[0]);
  const readyPending = page.status === "ready" && page.pending;
  const loading = readyPending && page.id !== "agreed";
  if (readyPending) {
    void callHook("loadPageRecord", plan.round, page.id).catch(arrived);
  }
  disposeRenderers();
  $("page-title").textContent = page.title;
  if (page.id === "agreed" && !page.waiting && isPlanRound()) {
    $("page-title").append(" ", tag("Plan", "plan"));
  }
  const drawing = populatePageBody();
  countNotes();
  renderSentPageComments();
  window.planUI.page = page;
  window.planUI.round = plan.round;
  window.dispatchEvent(
    new CustomEvent("plan:page", {
      detail: { page, element: $("page-content"), round: plan.round },
    }),
  );
  // Figure renderers can change a block's height after the page renders,
  // so placeMarks() runs again once they settle.
  Promise.allSettled(renders).then(placeMarks);
  return { drawing, loading };
}

function updateCurrentPageButtons() {
  for (const button of document.querySelectorAll("#page-list [data-page]")) {
    if (button.dataset.page === visiblePageId()) {
      button.setAttribute("aria-current", "page");
    } else button.removeAttribute("aria-current");
  }
}

function updateAddress({ targetId, keepScroll, match, push }) {
  const url = new URL(location.href);
  url.hash = shownPage();
  url.searchParams.delete("target");
  if (targetId) url.searchParams.set("target", targetId);
  if (!keepScroll) url.searchParams.delete("match");
  if (match) url.searchParams.set("match", match);
  // Back and a reload return to this round only when the address names it.
  if (selectedTab === "past" && editable) {
    url.searchParams.set("round", plan.round);
  } else url.searchParams.delete("round");
  if (push && !embedded && url.href !== location.href) {
    history.pushState(null, "", url);
  } else history.replaceState(null, "", url);
}

function landingAnchor(keepScroll, kept, targetId) {
  if (keepScroll) return kept;
  if (targetId) return { target: targetId };
  return savedPlace();
}

function prepareShow(targetId, { keepScroll, inPlace, match }) {
  redrawHeld = false;
  // A re-render keeps an opened result's highlight, and any arrival replaces it.
  if (!keepScroll) setMatch(matchWords(match), targetId, match);
  if (!keepScroll && !inPlace && !embedded) beginMove();
  // A re-render keeps the reader's place. Any other show() is an arrival,
  // and flushPlace() first saves the place it leaves.
  const kept = keepScroll ? placeOnScreen() : null;
  if (!keepScroll) flushPlace();
  setDisplayedRound(viewKey());
  return kept;
}

function showView(pageId, targetId) {
  // The waiting view has no Review page, because its round's feedback is
  // sent, so a saved place or a #feedback link opens its Agreed.
  const feedback =
    pageId === "feedback" && hasFeedbackPage && !showingWaiting();
  const work = pageId === "work" && hasWork();
  const stayed = work && !$("work-view").hidden;
  $("reading").hidden = feedback || work;
  $("review-view").hidden = !feedback;
  $("work-view").hidden = !work;
  // A chosen block belongs to the view it was chosen in.
  if (!stayed) chooseBlock(null);
  if (work) {
    openWork(targetId, stayed);
    return { drawing: null, loading: false };
  }
  // placeThreads() puts the threads on the overall comment at the end of
  // Review only while Review is on screen, so show() calls it before land()
  // reveals a reply in one of them.
  if (feedback) {
    placeThreads();
    return { drawing: null, loading: false };
  }
  return renderReadingPage(pageId);
}

// show() pushes a history entry on a page change, so the back button and a
// pasted hash both work. Re-rendering the same page, restoring after a
// reload, and popstate itself replace the entry instead.
// inPlace re-renders the page on screen for an arrival without closing the
// sidebar or another menu, and without moving focus.
export function show(id, targetId = null, options = {}) {
  const {
    keepScroll = false,
    push = true,
    inPlace = false,
    match = null,
  } = options;
  const kept = prepareShow(targetId, { keepScroll, inPlace, match });
  // A thread or a card has overall as its note's page, and overall is on
  // Review.
  const pageId = id === "overall" ? "feedback" : id;
  const { drawing, loading } = showView(pageId, targetId);
  updateCurrentPageButtons();
  updateAddress({ targetId, keepScroll, match, push });
  if (!inPlace) closeMenus();
  updateNavigation();
  review();
  // review() places the page's thread cards, and moving a card takes focus
  // away from the target, so land() runs after review().
  land(landingAnchor(keepScroll, kept, targetId), { focusHeading: !inPlace });
  whenDrawn(drawing, () => {
    if (!loading) arrived();
    markMatch();
  });
  Promise.allSettled(renders).then(markMatch);
}

/* showChanges shows the draft after it changed outside this tab's own
   controls, from the hub or from another tab. pages names the pages whose
   items changed, and null means any page. showChanges sets the choices,
   answers and note marks on the page at once, and sends plan:draft to each
   control, so a component updates what it derives from the draft, such as an
   answered question. Drawing the page again covers a page's own scripts, but
   it replaces every field, video and thread card on the page, so redrawPage
   waits while the reviewer uses one of them or has a modal open. The frame
   calls redrawPage again after each status poll. */
let redrawHeld = false;
export function showChanges(changed = null) {
  review();
  if (
    $("reading").hidden ||
    page.pending ||
    (changed && !changed.has(page.id))
  ) {
    return;
  }
  restoreChoices();
  restoreAnswers();
  if (page.id !== "agreed") markNotes();
  for (const control of $("page-content").querySelectorAll(
    "[data-multiselect], [data-question], [data-drawing-question]",
  )) {
    control.dispatchEvent(new CustomEvent("plan:draft"));
  }
  redrawHeld = true;
  redrawPage();
}

export function redrawPage() {
  if (!redrawHeld || inUse() || $("reading").hidden) return;
  show(page.id, null, { keepScroll: true, push: false, inPlace: true });
}

// The footer's links and the [ and ] keys both use pageOrder().
export const pageOrder = () => [
  ...pages.filter((item) => item.id === "agreed"),
  ...pages.filter((item) => item.id !== "agreed"),
  ...(hasFeedbackPage && !showingWaiting()
    ? [{ id: "feedback", title: "What you sent" }]
    : []),
];

function setFooterLink(element, item, text) {
  element.hidden = !item;
  if (!item) return;
  element.textContent = text;
  element.dataset.page = item.id;
  element.href = "#" + item.id;
}

function nextFooterLabel(next) {
  if (!next) return "";
  if (next.id !== "feedback") return `Next: ${next.title} →`;
  const sent = !editable || selectedTab === "past" || sendState() === "waiting";
  return sent ? "What you sent →" : "Review your draft →";
}

export function renderFooter(feedback) {
  const order = pageOrder();
  const index = order.findIndex(
    (item) => item.id === (feedback ? "feedback" : page.id),
  );
  const previous = order[index - 1];
  const next = order[index + 1];
  if (feedback) return;
  setFooterLink(
    $("footer-previous"),
    previous,
    previous ? `← Previous: ${previous.title}` : "",
  );
  setFooterLink($("footer-next"), next, nextFooterLabel(next));
}

function addPageButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.page = item.id;
  const title = document.createElement("span");
  title.textContent = item.title;
  // A long name ends in an ellipsis, so the title attribute shows the full
  // name.
  title.title = item.title;
  button.append(title);
  if (item.status !== "ready" && item.pending) {
    button.classList.add("pending");
    button.setAttribute(
      "aria-label",
      `${item.title}, ${item.working ? "being prepared" : "queued"}`,
    );
    button.append(pageIndicator(item.working ? "active" : "queued"));
  } else {
    button.append(pageIndicator("complete"));
  }
  $("page-list").append(button);
}

let pageList;

function recordVisiblePageOpened() {
  if (document.visibilityState !== "visible" || embedded) return;
  const onScreen = pages.find((item) => item.id === visiblePageId());
  if (!onScreen || pageStatus(onScreen) !== "complete") return;
  if (markOpened(session.sessionId, plan.round, onScreen.id)) {
    window.dispatchEvent(new CustomEvent("pair:opened"));
  }
}

/* newMarks() marks New on each ready page of the live current round that no
   browser on the hub has opened, and counts the page on screen as opened
   while the tab is visible. It returns the opened pages, or null when it
   marks no page. */
function newMarks(listed) {
  if (!editable || listed.tab !== "current" || listed.waiting) return null;
  if (listed.tab !== selectedTab) return openedPages();
  if (!current()) return null;
  recordVisiblePageOpened();
  return openedPages();
}

function buildNavRow(id, pageId, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.id = id;
  button.dataset.page = pageId;
  const label = document.createElement("span");
  label.textContent = text;
  const total = document.createElement("b");
  total.className = "count";
  total.hidden = true;
  button.append(label, total);
  return button;
}

function rebuildPageList(listed) {
  pageList.replaceChildren();
  addPageButton(listed.pages[0]);
  // This separator divides Agreed from the round's pages. The waiting
  // Current and a closed round with no published page list only Agreed.
  if (listed.pages.length > 1) pageList.append(separator());
  for (const item of listed.pages.slice(1)) addPageButton(item);
  if (hasWork()) {
    pageList.append(separator(), buildNavRow("work-row", "work", "Work"));
  }
  if (hasFeedbackPage && !listed.waiting) {
    const label =
      editable && listed.tab === "current" ? "Review" : "What you sent";
    pageList.append(separator(), buildNavRow("review-row", "feedback", label));
  }
  pageList.dataset.round = listed.round;
  pageList.dataset.tab = listed.tab;
}

function updateWorkRow() {
  const workRow = $("work-row");
  if (!workRow) return;
  const proposed = proposedCount();
  const mark = workRow.querySelector(".count");
  mark.textContent = String(proposed);
  mark.hidden = !proposed;
  mark.title = `${proposed} proposed`;
  workRow.setAttribute("aria-label", proposed ? `Work, ${mark.title}` : "Work");
}

function pageAriaStatus(item, complete, fresh) {
  if (complete) return fresh ? "ready, not opened yet" : "ready";
  return item.working ? "working" : "queued";
}

function setFreshBadge(button, fresh) {
  const mark = button.querySelector(".page-new");
  if (fresh && !mark) {
    const label = document.createElement("span");
    label.className = "page-new";
    label.textContent = "New";
    button.querySelector(".page-activity").before(label);
  } else if (!fresh) {
    mark?.remove();
  }
}

function syncPageButton(item, listed, opened) {
  const button = [...pageList.querySelectorAll("[data-page]")].find(
    (node) => node.dataset.page === item.id,
  );
  if (!button) return;
  const complete = pageStatus(item) === "complete";
  button.classList.toggle("pending", !complete);
  const old = button.querySelector(".page-activity");
  const next = pageIndicator(pageStatus(item));
  if (old?.className !== next.className) old?.replaceWith(next);
  const fresh =
    complete &&
    Boolean(opened) &&
    !opened.has(pageKey(session.sessionId, listed.round, item.id));
  setFreshBadge(button, fresh);
  button.setAttribute(
    "aria-label",
    `${item.title}, ${pageAriaStatus(item, complete, fresh)}`,
  );
}

function syncNavAriaCurrent(listed) {
  const activeId = listed.tab === selectedTab ? visiblePageId() : null;
  for (const button of pageList.querySelectorAll("[data-page]")) {
    if (button.dataset.page === activeId) {
      button.setAttribute("aria-current", "page");
    } else button.removeAttribute("aria-current");
  }
}

export function updateNavigation(force = false) {
  const listed = callHook("listedPages");
  $("current-tab").disabled = Boolean(submittedRound) && !currentShown();
  $("past-tab").disabled = !pastAvailable();
  $("past-tab").textContent = olderPast() ? `Round ${pastRound}` : "Last round";
  for (const tab of ["past", "current"]) {
    $(`${tab}-tab`).setAttribute("aria-selected", String(listed.tab === tab));
  }
  const listStale =
    force ||
    pageList.dataset.round !== listed.round ||
    pageList.dataset.tab !== listed.tab;
  if (listStale) rebuildPageList(listed);
  updateWorkRow();
  const opened = newMarks(listed);
  for (const item of listed.pages) syncPageButton(item, listed, opened);
  syncNavAriaCurrent(listed);
}

export function installPages() {
  setDisplayedRound(plan.round);
  const tabs = document.createElement("div");
  tabs.className = "page-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Page versions");
  for (const tab of ["past", "current"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `${tab}-tab`;
    button.dataset.tab = tab;
    button.setAttribute("role", "tab");
    button.textContent = tab === "current" ? "Current" : "Last round";
    tabs.append(button);
  }
  // A read-only page shows one round, so there is nothing to switch to.
  tabs.hidden = !editable;
  pageList = document.createElement("div");
  pageList.id = "page-list";
  $("navigation").append(tabs, pageList);
  updateNavigation(true);
  $("feedback-pages").addEventListener("click", openSidebar);
  document.addEventListener("visibilitychange", () => updateNavigation());
}
