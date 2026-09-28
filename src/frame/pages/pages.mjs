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
import { $, plural } from "#frame/app/util.mjs";
import {
  currentAvailable,
  currentShown,
  editable,
  hasFeedbackPage,
  page,
  pages,
  pastAvailable,
  pastRound,
  plan,
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
import { renderAgreements } from "#frame/pages/agreed.mjs";
import { disposeRenderers, renders } from "#frame/pages/renderers.mjs";
import { renderSentPageComments, review } from "#frame/review/review.mjs";
import { closeMenus } from "#frame/sync/rounds-dialog.mjs";
import {
  loadPageRecord,
  pageSets,
  pageStatus,
  pendingState,
  remote,
  selectedTab,
} from "#frame/sync/rounds.mjs";

export let displayedRound;
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
  displayedRound = viewKey();
  const resuming = restoring?.round === displayedRound && restoring.page === id;
  if (!resuming) endRestore();
  const top = scroller().scrollTop;
  const feedback = id === "feedback" && hasFeedbackPage;
  $("reading").hidden = feedback;
  $("feedback").hidden = !feedback;
  if (!feedback) {
    clearHighlight("plan-note");
    setPage(pages.find((item) => item.id === id) || pages[0]);
    if (page.status === "ready" && page.pending)
      void loadPageRecord(plan.round, page.id).catch(() => {});
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
    if (page.id === "agreed" && !page.waiting) renderAgreements();
    else if (!page.pending) {
      restoreChoices();
      restoreAnswers();
      markNotes();
      enhance($("page-content"));
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
  if (!feedback) reveal(targetId);
  $("quote").hidden = true;
  if (!inPlace) closeMenus();
  review();
}
// Scrolls to an element of the page on screen and focuses it, opening any
// details around it.
export function reveal(targetId) {
  const target = targetId && $(targetId);
  if (!target || !$("page-content").contains(target)) return;
  for (let ancestor = target; ancestor; ancestor = ancestor.parentElement)
    if (ancestor.tagName === "DETAILS") ancestor.open = true;
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
export function updateNavigation(force = false) {
  const currentSet = pageSets.get(remote?.current?.round);
  const readyPages = currentAvailable()
    ? currentSet?.pages.filter((item) => item.state === "ready").length || 0
    : selectedTab === "current"
      ? pages.filter((item) => !item.pending).length
      : 0;
  $("page-count").hidden = !readyPages;
  $("page-count").textContent = readyPages;
  $("menu-button").classList.toggle("need", readyPages > 0);
  $("menu-button").setAttribute(
    "aria-label",
    `Pages, ${plural(readyPages, "current page")} ready to read`,
  );
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
  for (const item of pages) {
    const button = [...pageList.querySelectorAll("[data-page]")].find(
      (node) => node.dataset.page === item.id,
    );
    if (!button) continue;
    button.classList.toggle("pending", pageStatus(item) !== "complete");
    const old = button.querySelector(".page-activity");
    const next = pageIndicator(pageStatus(item));
    if (old?.className !== next.className) old?.replaceWith(next);
    button.setAttribute(
      "aria-label",
      `${item.title}, ${pageStatus(item) === "complete" ? "ready" : item.working ? "working" : "queued"}`,
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
  $("menu-button").addEventListener("click", () =>
    $("pages-dialog").open ? closeDrawer() : openDrawer(),
  );
  $("feedback-pages").addEventListener("click", openDrawer);
}
