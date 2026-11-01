import { $ } from "#frame/app/util.mjs";
import { page, plan } from "#frame/app/view.mjs";
import { show } from "#frame/pages/pages.mjs";
import { useTheme } from "#frame/pages/renderers.mjs";
import { openResult, pageOf, targetOf } from "#frame/search/open.mjs";
import { ensurePageSet, remote } from "#frame/sync/rounds.mjs";

/* The session's real frame, inside the search window. It goes to a result the
   way Open does, through the page's own code, so everything on screen is what
   the page draws. This code only hides what isn't the result. */
const HIDE = "embed-hide";
const ARRIVE_LIMIT_MS = 30000;
const ARRIVE_POLL_MS = 20;
const isThread = (node) => node?.localName === "pair-thread";
const isHeading = (node) => /^H[1-6]$/.test(node?.tagName ?? "");

let wanted = null;
let showing = true;
export const embedShowing = () => showing;

const hide = (element, on = true) => element.classList.toggle(HIDE, on);
// The thread cards under a block belong to it.
function withThreads(node) {
  const kept = new Set([node]);
  for (
    let at = node.nextElementSibling;
    isThread(at);
    at = at.nextElementSibling
  )
    kept.add(at);
  return kept;
}
function keepOnly(parent, kept) {
  for (const child of parent.children) hide(child, !kept.has(child));
}
// A thread on a whole page has no block, and the frame puts its card at the end.
function onWholePage(card) {
  const thread = (remote?.threads ?? []).find(
    (item) => item.id === card.dataset.thread,
  );
  return thread && !thread.target && !thread.quote;
}
function showBlock(element, root) {
  let top = element;
  while (top.parentElement !== root) top = top.parentElement;
  if (isThread(top) && onWholePage(top)) return keepOnly(root, new Set([top]));
  while (isThread(top) && top.previousElementSibling)
    top = top.previousElementSibling;
  const kept = withThreads(top);
  if (!isHeading(top)) {
    const above = [...root.children]
      .slice(0, [...root.children].indexOf(top))
      .findLast(isHeading);
    if (above) kept.add(above);
  }
  keepOnly(root, kept);
  // An Agreed item is one card in one list.
  const card = element.closest("[id^='agreement-']");
  if (card && card.parentElement !== root)
    keepOnly(card.parentElement, withThreads(card));
}
// Work and Feedback hold cards in lists, with their own headings and tabs.
function showCard(element, view) {
  for (let at = element; at !== view; at = at.parentElement)
    keepOnly(at.parentElement, withThreads(at));
}
function isolate() {
  for (const element of document.querySelectorAll(`.${HIDE}`))
    hide(element, false);
  const page = wanted?.startsWith("proposal-")
    ? document.querySelector(
        `[data-proposal-card="${CSS.escape(wanted.slice("proposal-".length))}"]`,
      )
    : wanted && document.getElementById(wanted);
  document.documentElement.toggleAttribute("data-embed-whole", !page);
  // The round's progress and its threads sit above the page.
  for (const part of document.querySelectorAll(
    "#agent-activity, #finished-line, #finished-line ~ pair-thread",
  ))
    if (!part.contains(page)) hide(part);
  if (!page) return;
  const root = $("page-content");
  if (root.contains(page)) return showBlock(page, root);
  const view = page.closest("#work-view, #review-view, #reading");
  if (view) showCard(page, view);
}
// A page still on its way shows a placeholder, and another page can show before
// that, so the search window waits for the result's own page.
function arrived(row) {
  const id = pageOf(row) || "agreed";
  if (id === "work") return !$("work-view").hidden;
  if (id === "feedback") return !$("review-view").hidden;
  return (
    (!row.round || plan.round === row.round) &&
    page.id === id &&
    !page.pending &&
    $("page-content").dataset.pageId === id
  );
}
async function whenArrived(row, target) {
  const limit = Date.now() + ARRIVE_LIMIT_MS;
  while (wanted === target && Date.now() < limit && !arrived(row))
    await new Promise((done) => setTimeout(done, ARRIVE_POLL_MS));
}
function pause() {
  for (const media of document.querySelectorAll("video, audio")) media.pause();
}
export function installEmbed() {
  document.documentElement.dataset.embed = "";
  let queued = false;
  const soon = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      isolate();
    });
  };
  const watch = { childList: true };
  new MutationObserver(soon).observe($("page-content"), watch);
  new MutationObserver(soon).observe($("work-view"), {
    childList: true,
    subtree: true,
  });
  new MutationObserver(soon).observe($("review-view"), {
    childList: true,
    subtree: true,
  });
  window.pairEmbed = {
    async open(row, query) {
      pause();
      const target = targetOf(row);
      wanted = target;
      await ensurePageSet();
      if (wanted !== target) return;
      const match = query.trim();
      if (row.round) openResult({ ...row, page: pageOf(row) }, query);
      else show(row.page || "agreed", target, { match });
      await whenArrived(row, target);
      isolate();
    },
    show(on) {
      showing = on;
      if (!on) pause();
    },
    pause,
    theme: useTheme,
  };
}
