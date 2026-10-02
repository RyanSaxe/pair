import {
  endRestore,
  places,
  rememberPlace,
  restoreScroll,
  restoring,
  scroller,
  settleScroll,
} from "#frame/app/places.mjs";
import { enhance } from "#frame/app/registry.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  current,
  currentShown,
  editable,
  hasFeedbackPage,
  page,
  pages,
  pastAvailable,
  pastRound,
  plan,
  session,
  setPage,
  showingWaiting,
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
import { renderAgreements, showAgreedTab } from "#frame/pages/agreed.mjs";
import { arrived, beginMove } from "#frame/pages/progress.mjs";
import { disposeRenderers, renders } from "#frame/pages/renderers.mjs";
import { renderSentPageComments, review } from "#frame/review/review.mjs";
import { markOpened, openedPages, pageKey } from "#frame/sync/opened.mjs";
import { closeMenus } from "#frame/sync/rounds-dialog.mjs";
import {
  loadPageRecord,
  pageStatus,
  pendingState,
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
  return $("reading").hidden ? "feedback" : page.id;
}
// Page changes push history so the back button and a pasted hash both work;
// re-rendering the same page, restoring after a reload, and popstate itself
// leave history alone.
// inPlace re-renders the page on screen for an arrival, without closing the
// Pages drawer or another menu, or moving focus.
export function show(
  id,
  targetId = null,
  { keepScroll = false, push = true, inPlace = false } = {},
) {
  if (!keepScroll && !inPlace) beginMove();
  displayedRound = viewKey();
  const resuming = restoring?.round === displayedRound && restoring.page === id;
  if (!resuming) endRestore();
  const top = scroller().scrollTop;
  // The waiting view has no Review page, because its round's feedback is
  // sent, so a saved place or a #feedback link opens its Agreed.
  const feedback = id === "feedback" && hasFeedbackPage && !showingWaiting();
  let drawing = null;
  // A page whose record is still loading is shown again once it loads, and
  // the move ends with that. Before the first poll, a page missing from the
  // served round may be published, so it counts as loading until the page
  // set says whether its placeholder is all there is.
  let loading = false;
  $("reading").hidden = feedback;
  $("feedback").hidden = !feedback;
  if (!feedback) {
    clearHighlight("plan-note");
    setPage(pages.find((item) => item.id === id) || pages[0]);
    loading =
      page.pending &&
      page.id !== "agreed" &&
      (page.status === undefined || page.status === "ready");
    if (page.status === "ready" && page.pending)
      void loadPageRecord(plan.round, page.id).catch(arrived);
    disposeRenderers();
    $("page-title").textContent = page.title;
    chooseBlock(null);
    $("page-content").dataset.pageId = page.id;
    $("page-content").dataset.round = plan.round;
    const [mark, label] = pendingState(page);
    $("page-content").innerHTML = page.pending
      ? `<div class="pending-page ${mark === "active" ? "working" : "queued"}"><span class="pending-state">${pageIndicator(mark).outerHTML}${label}</span><div class="pending-skeleton" aria-hidden="true"><i></i><i></i><i></i></div></div>`
      : page.html;
    if (!page.pending) {
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
  if (!inPlace) closeDrawer();
  for (const button of document.querySelectorAll("#page-list [data-page]")) {
    if (button.dataset.page === visiblePageId())
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const url = new URL(location.href);
  url.hash = feedback ? "feedback" : page.id;
  url.searchParams.delete("target");
  if (targetId) url.searchParams.set("target", targetId);
  if (push && url.href !== location.href) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  if (!inPlace)
    (feedback ? $("feedback").querySelector("h1") : $("page-title")).focus({
      preventScroll: true,
    });
  // Returning to a page within a round lands where the reader left it.
  if (!keepScroll) {
    const saved = targetId
      ? 0
      : places[displayedRound]?.tops?.[feedback ? "feedback" : page.id];
    if (saved) restoreScroll(saved);
    else scroller().scrollTo(0, 0);
  } else if (resuming) settleScroll();
  else if (!targetId) {
    // Replacing the page shortens it until the renderers finish, and the
    // browser clamps the scroll position meanwhile; restore it after they do.
    scroller().scrollTo(0, top);
    Promise.allSettled([...renders]).then(() => scroller().scrollTo(0, top));
  }
  rememberPlace();
  $("quote").hidden = true;
  if (!inPlace) closeMenus();
  updateNavigation();
  review();
  // review() places the page's thread cards, and moving a card takes focus
  // from it, so a target is revealed after them.
  whenDrawn(drawing, () => {
    if (!loading) arrived();
    if (!feedback) reveal(targetId);
  });
}
// Scrolls to an element of the page on screen and focuses it, opening any
// details around it and the Agreed tab that holds it.
export function reveal(targetId) {
  const target = targetId && $(targetId);
  // A Progress thread's card is above the page content, under the progress
  // card or the finished line.
  if (!target || !$("reading").contains(target)) return;
  const panel = target.closest(".agreed-panel");
  if (panel) showAgreedTab(panel.id);
  for (let ancestor = target; ancestor; ancestor = ancestor.parentElement)
    if (ancestor.tagName === "DETAILS") ancestor.open = true;
  // A collapsed thread card shows only its head, so a reply inside it has no
  // box to scroll to until the card expands, as its Expand button does.
  const card = target.closest("pair-thread[collapsed]");
  if (card) card.querySelector(".thread-fold").click();
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "center" });
}
export function badge(count) {
  const row = $("review-row");
  if (!row) return;
  const mark = row.querySelector(".count");
  mark.textContent = count ? `(${count})` : "";
  mark.hidden = !count;
}
/* On a narrow screen the page list is a dialog, like every other panel.
   The one navigation element moves between the sidebar and the dialog, so
   the current page and the counts live in a single place. */
export let narrow;
export function placeNavigation() {
  const target = narrow.matches ? $("pages-slot") : $("sidebar-slot");
  if ($("navigation").parentElement !== target) target.append($("navigation"));
  if (!narrow.matches) closeDrawer();
}
function openDrawer() {
  $("pages-dialog").showModal();
  $("menu-button").setAttribute("aria-expanded", "true");
}
export function closeDrawer() {
  if (!$("pages-dialog").open) return;
  $("pages-dialog").close();
  $("menu-button").setAttribute("aria-expanded", "false");
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

// Agreed so far reads before the pages, Review or Feedback after them, each
// behind a separator, and the drawer shows the same list as the sidebar.
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
  $("past-tab").textContent = pastRound ? `Round ${pastRound}` : "Previous";
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
  narrow = matchMedia("(max-width: 720px)");
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
    button.textContent = tab === "current" ? "Current" : "Previous";
    tabs.append(button);
  }
  // A read-only page shows one round, so there is nothing to switch to.
  tabs.hidden = !editable;
  pageList = document.createElement("div");
  pageList.id = "page-list";
  $("navigation").append(tabs, pageList);
  updateNavigation(true);
  // Above 720px the button opens the session list through its
  // popovertarget. At 720px and below it opens this drawer instead.
  $("menu-button").addEventListener("click", (event) => {
    if (!narrow.matches) return;
    event.preventDefault();
    if ($("pages-dialog").open) closeDrawer();
    else openDrawer();
  });
  $("feedback-pages").addEventListener("click", openDrawer);
}
