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
import { openWork, workCounts } from "#frame/pages/work.mjs";
import { disposeRenderers, renders } from "#frame/pages/renderers.mjs";
import { renderSentPageComments, review } from "#frame/review/review.mjs";
import { markOpened, openedPages, pageKey } from "#frame/sync/opened.mjs";
import { closeMenus } from "#frame/sync/rounds-panel.mjs";
import {
  listedPages,
  loadPageRecord,
  pageStatus,
  selectedTab,
} from "#frame/sync/rounds.mjs";

export let displayedRound;
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
// show() pushes a history entry on a page change, so the back button and a
// pasted hash both work. Re-rendering the same page, restoring after a
// reload, and popstate itself replace the entry instead.
// inPlace re-renders the page on screen for an arrival without closing the
// sidebar or another menu, and without moving focus.
export function show(
  id,
  targetId = null,
  { keepScroll = false, push = true, inPlace = false } = {},
) {
  redrawHeld = false;
  // A thread or a card has overall as its note's page, and overall is on
  // Review.
  if (id === "overall") id = "feedback";
  if (!keepScroll && !inPlace) beginMove();
  // A re-render keeps the reader's place. Any other show() is an arrival,
  // and flushPlace() first saves the place it leaves.
  const kept = keepScroll ? placeOnScreen() : null;
  if (!keepScroll) flushPlace();
  displayedRound = viewKey();
  // The waiting view has no Review page, because its round's feedback is
  // sent, so a saved place or a #feedback link opens its Agreed.
  const feedback = id === "feedback" && hasFeedbackPage && !showingWaiting();
  const work = id === "work" && hasWork();
  const stayed = work && !$("work-view").hidden;
  let drawing = null;
  // While the page's record is still loading, show() does not end the move.
  // The frame shows the page again once the record loads, and that show()
  // ends the move.
  let loading = false;
  $("reading").hidden = feedback || work;
  $("review-view").hidden = !feedback;
  $("work-view").hidden = !work;
  // A chosen block belongs to the view it was chosen in.
  if (!stayed) chooseBlock(null);
  if (work) openWork(targetId, stayed);
  // placeThreads() puts the threads on the overall comment at the end of
  // Review only while Review is on screen, so show() calls it before land()
  // reveals a reply in one of them.
  else if (feedback) placeThreads();
  else {
    clearHighlight("plan-note");
    setPage(pages.find((item) => item.id === id) || pages[0]);
    loading = page.status === "ready" && page.pending && page.id !== "agreed";
    if (page.status === "ready" && page.pending)
      void loadPageRecord(plan.round, page.id).catch(arrived);
    disposeRenderers();
    $("page-title").textContent = page.title;
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
    // Figure renderers can change a block's height after the page renders,
    // so placeMarks() runs again once they settle.
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
  // away from the target, so land() runs after review().
  land(keepScroll ? kept : targetId ? { target: targetId } : savedPlace(), {
    focusHeading: !inPlace,
  });
  whenDrawn(drawing, () => {
    if (!loading) arrived();
  });
}
/* showChanges shows the draft after it changed outside this tab's own
   controls, from the hub or from another tab. pages names the pages whose
   items changed, and null means any page. showChanges sets the choices,
   answers and note marks on the page at once, and sends plan:draft to each
   control, so a component updates what it derives from the draft, such as an
   answered question. Drawing the page again covers a page's own scripts, but
   it replaces every field, video and thread card on the page, so redrawPage
   waits while the reviewer uses one of them or has a dialog open. The frame
   calls redrawPage again after each status poll. */
let redrawHeld = false;
export function showChanges(pages = null) {
  review();
  if ($("reading").hidden || page.pending || (pages && !pages.has(page.id)))
    return;
  restoreChoices();
  restoreAnswers();
  if (page.id !== "agreed") markNotes();
  for (const control of $("page-content").querySelectorAll(
    "[data-multiselect], [data-question], [data-drawing-question]",
  ))
    control.dispatchEvent(new CustomEvent("plan:draft"));
  redrawHeld = true;
  redrawPage();
}
const fields =
  "textarea, input:is([type=text], [type=search], :not([type])), [contenteditable], iframe, video, audio";
// A video keeps its place only while the page keeps its element.
const started = (media) =>
  !media.paused || (media.currentTime > 0 && !media.ended);
const inUse = () =>
  Boolean(document.querySelector("dialog[open], #reading :active")) ||
  (document.hasFocus() && Boolean(document.activeElement?.matches(fields))) ||
  [...document.querySelectorAll("video, audio")].some(started);
export function redrawPage() {
  if (!redrawHeld || inUse() || $("reading").hidden) return;
  show(page.id, null, { keepScroll: true, push: false, inPlace: true });
}
export function badge(count) {
  const row = $("review-row");
  if (!row) return;
  const mark = row.querySelector(".count");
  mark.textContent = count ? `(${count})` : "";
  mark.hidden = !count;
}
// The footer's links and the [ and ] keys both use pageOrder().
export const pageOrder = () => [
  ...pages.filter((item) => item.id === "agreed"),
  ...pages.filter((item) => item.id !== "agreed"),
  ...(hasFeedbackPage && !showingWaiting()
    ? [{ id: "feedback", title: "Feedback" }]
    : []),
];
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

export function separator() {
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
/* newMarks() marks New on each ready page of the live current round that no
   browser on the hub has opened, and counts the page on screen as opened
   while the tab is visible. It returns the opened pages, or null when it
   marks no page. */
function newMarks(listed) {
  if (!editable || listed.tab !== "current" || listed.waiting) return null;
  if (listed.tab !== selectedTab) return openedPages();
  if (!current()) return null;
  const onScreen = pages.find((item) => item.id === visiblePageId());
  if (
    document.visibilityState === "visible" &&
    onScreen &&
    pageStatus(onScreen) === "complete" &&
    markOpened(session.sessionId, plan.round, onScreen.id)
  )
    window.dispatchEvent(new CustomEvent("pair:opened"));
  return openedPages();
}
export function updateNavigation(force = false) {
  const listed = listedPages();
  $("current-tab").disabled = Boolean(submittedRound) && !currentShown();
  $("past-tab").disabled = !pastAvailable();
  $("past-tab").textContent = olderPast() ? `Round ${pastRound}` : "Last round";
  for (const tab of ["past", "current"])
    $(`${tab}-tab`).setAttribute("aria-selected", String(listed.tab === tab));
  if (
    force ||
    pageList.dataset.round !== listed.round ||
    pageList.dataset.tab !== listed.tab
  ) {
    pageList.replaceChildren();
    addPageButton(listed.pages[0]);
    // The waiting Current lists only Agreed, so it needs no separator.
    if (!listed.waiting) pageList.append(separator());
    for (const item of listed.pages.slice(1)) addPageButton(item);
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
    if (hasFeedbackPage && !listed.waiting) {
      const review = document.createElement("button");
      review.type = "button";
      review.id = "review-row";
      review.dataset.page = "feedback";
      const label = document.createElement("span");
      label.textContent =
        editable && listed.tab === "current" ? "Review" : "Feedback";
      const total = document.createElement("b");
      total.className = "count";
      total.hidden = true;
      review.append(label, total);
      pageList.append(separator(), review);
    }
    pageList.dataset.round = listed.round;
    pageList.dataset.tab = listed.tab;
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
  const opened = newMarks(listed);
  for (const item of listed.pages) {
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
      !opened.has(pageKey(session.sessionId, listed.round, item.id));
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
    if (listed.tab === selectedTab && button.dataset.page === visiblePageId())
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
}
export function installPages() {
  displayedRound = plan.round;
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
