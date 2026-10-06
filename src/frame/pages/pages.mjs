import {
  flushPlace,
  land,
  placeOnScreen,
  savedPlace,
} from "#frame/app/places.mjs";
import { enhance } from "#frame/app/registry.mjs";
import { openSidebar } from "#frame/app/sidebar.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  current,
  currentShown,
  editable,
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
  submittedCurrent,
  submittedRound,
  viewKey,
} from "#frame/app/view.mjs";
import { blockTargets, chooseBlock } from "#frame/notes/blocks.mjs";
import {
  choiceTargets,
  restoreAnswers,
  restoreChoices,
} from "#frame/notes/controls.mjs";
import {
  clearHighlight,
  countNotes,
  markNotes,
  placeMarks,
} from "#frame/notes/notes.mjs";
import { placeThreads } from "#frame/notes/threads.mjs";
import { renderAgreements, tag } from "#frame/pages/agreed.mjs";
import { pendingPage, updatePending } from "#frame/pages/pending.mjs";
import { arrived, beginMove } from "#frame/pages/progress.mjs";
import { openWork, refreshWork, workCounts } from "#frame/pages/work.mjs";
import { disposeRenderers, renders } from "#frame/pages/renderers.mjs";
import { renderSentPageComments, review } from "#frame/review/review.mjs";
import { markOpened, openedPages, pageKey } from "#frame/sync/opened.mjs";
import { closeMenus } from "#frame/sync/rounds-panel.mjs";
import {
  loadPageRecord,
  pageStatus,
  selectedTab,
} from "#frame/sync/rounds.mjs";

export let displayedRound;
/* A page whose diagrams or formulas are still drawing stays hidden, with
   its layout kept, until they draw, so nothing on it moves once it
   appears. A setup that never settles holds the page back for at most
   DRAW_LIMIT_MS. Each show() takes a new generation, so an older page's
   wait never uncovers a newer page early. */
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
// Work is on every round of a session the hub serves.
const hasWork = () => online && hasFeedbackPage;
// Page changes push history so the back button and a pasted hash both work;
// re-rendering the same page, restoring after a reload, and popstate itself
// leave history alone.
// inPlace re-renders the page on screen for an arrival, without closing the
// sidebar over the page or another menu, or moving focus.
export function show(
  id,
  targetId = null,
  { keepScroll = false, push = true, inPlace = false } = {},
) {
  // Review's overall comment is on Review, which a thread or a card names
  // by the note's page, overall.
  if (id === "overall") id = "feedback";
  if (!keepScroll && !inPlace) beginMove();
  // A re-render keeps the reader's place, and any other show() is an
  // arrival, which notes the place it leaves first.
  const kept = keepScroll ? placeOnScreen() : null;
  if (!keepScroll) flushPlace();
  displayedRound = viewKey();
  // The waiting view has no Review page, because its round's feedback is
  // sent, so a saved place or a #feedback link opens its Agreed.
  const feedback = id === "feedback" && hasFeedbackPage && !showingWaiting();
  const work = id === "work" && hasWork();
  // Work opens on its first tab with a card, and keeps the tab the reader
  // chose while it stays on screen.
  const stayed = work && !$("work-view").hidden;
  let drawing = null;
  // A page whose record is still loading is shown again once it loads, and
  // the move ends with that.
  let loading = false;
  $("reading").hidden = feedback || work;
  $("review-view").hidden = !feedback;
  $("work-view").hidden = !work;
  // A choice belongs to the view it was made in.
  if (!stayed) chooseBlock(null);
  if (stayed) refreshWork(true);
  else if (work) openWork();
  // The threads on the overall comment go at the end of Review only while
  // it is on screen, so they are placed before a reply in one is revealed.
  else if (feedback) placeThreads();
  else {
    clearHighlight("plan-note");
    setPage(pages.find((item) => item.id === id) || pages[0]);
    loading = page.status === "ready" && page.pending && page.id !== "agreed";
    if (page.status === "ready" && page.pending)
      void loadPageRecord(plan.round, page.id).catch(arrived);
    disposeRenderers();
    $("page-title").textContent = page.title;
    // A plan round's Agreed has the Plan tag beside its title.
    if (page.id === "agreed" && !page.waiting && isPlanRound())
      $("page-title").append(" ", tag("Plan", "plan"));
    $("page-content").dataset.pageId = page.id;
    $("page-content").dataset.round = plan.round;
    $("page-content").innerHTML = page.pending ? pendingPage : page.html;
    if (page.pending) updatePending();
    else {
      blockTargets($("page-content"), page.id);
      choiceTargets($("page-content"), page.id);
    }
    if (page.id === "agreed" && !page.waiting) drawing = renderAgreements();
    else if (!page.pending) {
      restoreChoices();
      restoreAnswers();
      markNotes();
      drawing = enhance($("page-content"));
    }
    countNotes();
    renderSentPageComments();
    window.planUI.page = page;
    window.planUI.round = plan.round;
    window.dispatchEvent(
      new CustomEvent("plan:page", {
        detail: { page, element: $("page-content"), round: plan.round },
      }),
    );
    // Shiki, Mermaid and the charts all change a block's height after the
    // page renders, so the marks are placed again once they settle.
    Promise.allSettled([...renders]).then(placeMarks);
  }
  for (const button of document.querySelectorAll("#page-list [data-page]")) {
    if (button.dataset.page === visiblePageId())
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const url = new URL(location.href);
  url.hash = shownPage();
  url.searchParams.delete("target");
  if (targetId) url.searchParams.set("target", targetId);
  if (push && url.href !== location.href) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  if (!inPlace) closeMenus();
  updateNavigation();
  review();
  // review() places the page's thread cards, and moving a card takes focus
  // from it, so the page lands after them.
  land(keepScroll ? kept : targetId ? { target: targetId } : savedPlace(), {
    focusHeading: !inPlace,
  });
  whenDrawn(drawing, () => {
    if (!loading) arrived();
  });
}
export function badge(count) {
  const row = $("review-row");
  if (!row) return;
  const mark = row.querySelector(".count");
  mark.textContent = count ? `(${count})` : "";
  mark.hidden = !count;
}
// Agreed so far leads the order, as it leads the sidebar, and Feedback ends
// it. The footer's links and the [ and ] keys use this one order.
export const pageOrder = () => [
  ...pages.filter((item) => item.id === "agreed"),
  ...pages.filter((item) => item.id !== "agreed"),
  ...(hasFeedbackPage && !showingWaiting()
    ? [{ id: "feedback", title: "Feedback" }]
    : []),
];
// Every reading page ends with where you came from and where to go next.
export function renderFooter(feedback) {
  const order = pageOrder();
  const index = order.findIndex(
    (item) => item.id === (feedback ? "feedback" : page.id),
  );
  const previous = order[index - 1];
  const next = order[index + 1];
  const link = (element, item, text) => {
    element.hidden = !item;
    if (!item) return;
    element.textContent = text;
    element.dataset.page = item.id;
    element.href = "#" + item.id;
  };
  if (feedback) return;
  link(
    $("footer-previous"),
    previous,
    previous ? `← Previous: ${previous.title}` : "",
  );
  link(
    $("footer-next"),
    next,
    !next
      ? ""
      : next.id === "feedback"
        ? submittedCurrent() || !editable
          ? "Feedback →"
          : "Review your feedback →"
        : `Next: ${next.title} →`,
  );
}

// Agreed so far reads before the pages, and Review or Feedback after them,
// each behind a separator.
function separator() {
  const divider = document.createElement("div");
  divider.className = "separator";
  divider.setAttribute("role", "separator");
  return divider;
}
export function pageIndicator(state) {
  const indicator = document.createElement("span");
  indicator.className = `page-activity ${state}`;
  indicator.setAttribute("aria-hidden", "true");
  if (state !== "active")
    indicator.innerHTML =
      state === "complete"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  return indicator;
}
function addPageButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.page = item.id;
  const title = document.createElement("span");
  title.textContent = item.title;
  // A long name ends in an ellipsis, so the full name is a tooltip.
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
/* New marks each ready page of the live current round that this browser
   has not opened, and the ready page on screen counts as opened. Returns
   the opened pages, or null where no page is marked. */
function newMarks() {
  if (!editable || !current() || showingWaiting()) return null;
  const onScreen = pages.find((item) => item.id === visiblePageId());
  if (
    onScreen &&
    pageStatus(onScreen) === "complete" &&
    markOpened(session.sessionId, plan.round, onScreen.id)
  )
    window.dispatchEvent(new CustomEvent("pair:opened"));
  return openedPages();
}
export function updateNavigation(force = false) {
  $("current-tab").disabled = Boolean(submittedRound) && !currentShown();
  $("past-tab").disabled = !pastAvailable();
  $("past-tab").textContent = olderPast() ? `Round ${pastRound}` : "Last round";
  for (const tab of ["past", "current"])
    $(`${tab}-tab`).setAttribute("aria-selected", String(selectedTab === tab));
  if (
    force ||
    pageList.dataset.round !== plan.round ||
    pageList.dataset.tab !== selectedTab
  ) {
    pageList.replaceChildren();
    addPageButton(pages[0]);
    // The waiting Current lists Agreed alone.
    if (!showingWaiting()) pageList.append(separator());
    for (const item of pages.slice(1)) addPageButton(item);
    // Work sits above Review, with two numbers: the proposed cards, then
    // the cards that need the reviewer at the row's right edge.
    if (hasWork()) {
      const work = document.createElement("button");
      work.type = "button";
      work.id = "work-row";
      work.dataset.page = "work";
      const label = document.createElement("span");
      label.textContent = "Work";
      const counts = document.createElement("span");
      counts.className = "work-counts";
      for (const kind of ["proposed", "needs"]) {
        const total = document.createElement("b");
        total.className = `count ${kind}`;
        total.hidden = true;
        counts.append(total);
      }
      work.append(label, counts);
      pageList.append(separator(), work);
    }
    if (hasFeedbackPage && !showingWaiting()) {
      const review = document.createElement("button");
      review.type = "button";
      review.id = "review-row";
      review.dataset.page = "feedback";
      const label = document.createElement("span");
      label.textContent =
        editable && selectedTab === "current" ? "Review" : "Feedback";
      const total = document.createElement("b");
      total.className = "count";
      total.hidden = true;
      review.append(label, total);
      pageList.append(separator(), review);
    }
    pageList.dataset.round = plan.round;
    pageList.dataset.tab = selectedTab;
  }
  const workRow = $("work-row");
  if (workRow) {
    const counts = workCounts();
    const said = {
      needs: `${counts.needs} need${counts.needs === 1 ? "s" : ""} you`,
      proposed: `${counts.proposed} proposed`,
    };
    for (const kind of ["needs", "proposed"]) {
      const mark = workRow.querySelector(`.count.${kind}`);
      mark.textContent = String(counts[kind]);
      mark.hidden = !counts[kind];
      mark.title = said[kind];
    }
    workRow.setAttribute(
      "aria-label",
      [
        "Work",
        ...["needs", "proposed"]
          .filter((kind) => counts[kind])
          .map((kind) => said[kind]),
      ].join(", "),
    );
  }
  const opened = newMarks();
  for (const item of pages) {
    const button = [...pageList.querySelectorAll("[data-page]")].find(
      (node) => node.dataset.page === item.id,
    );
    if (!button) continue;
    const complete = pageStatus(item) === "complete";
    button.classList.toggle("pending", !complete);
    const old = button.querySelector(".page-activity");
    const next = pageIndicator(pageStatus(item));
    if (old?.className !== next.className) old?.replaceWith(next);
    const fresh =
      complete &&
      Boolean(opened) &&
      !opened.has(pageKey(session.sessionId, plan.round, item.id));
    const mark = button.querySelector(".page-new");
    if (fresh && !mark) {
      const label = document.createElement("span");
      label.className = "page-new";
      label.textContent = "New";
      button.querySelector(".page-activity").before(label);
    } else if (!fresh) mark?.remove();
    button.setAttribute(
      "aria-label",
      `${item.title}, ${complete ? (fresh ? "ready, not opened yet" : "ready") : item.working ? "working" : "queued"}`,
    );
  }
  for (const button of pageList.querySelectorAll("[data-page]"))
    if (button.dataset.page === visiblePageId())
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
}
export function installPages() {
  displayedRound = plan.round;
  const tabs = document.createElement("div");
  tabs.className = "page-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Page versions");
  // The left tab holds the past round on screen, so the tabs read in time
  // order.
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
}
