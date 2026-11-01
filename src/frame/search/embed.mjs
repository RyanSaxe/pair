import { $ } from "#frame/app/util.mjs";
import { base, editable, page, plan } from "#frame/app/view.mjs";
import { targetElement, whenLanded } from "#frame/notes/match.mjs";
import { show } from "#frame/pages/pages.mjs";
import { copyColumn } from "#frame/pages/progress.mjs";
import { renders, useTheme } from "#frame/pages/renderers.mjs";
import { sentCard, sentEntries } from "#frame/review/review.mjs";
import { openResult, pageOf, targetOf } from "#frame/search/open.mjs";
import { ensurePageSet, remote } from "#frame/sync/rounds.mjs";

/* The session's real frame, inside the search window. It goes to a result the
   way Open does, through the page's own code, so everything on screen is what
   the page draws. This code only hides what isn't the result. */
const HIDE = "embed-hide";
const ARRIVE_LIMIT_MS = 15000;
const ARRIVE_POLL_MS = 20;
// A page that never settles still shows, once the reader has waited this long.
const READY_LIMIT_MS = 8000;
const isThread = (node) => node?.localName === "pair-thread";
const isHeading = (node) => /^H[1-6]$/.test(node?.tagName ?? "");

let wanted = null;
let opens = 0;
let showing = true;
let onScreen = false;
let picture = null;
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
// What a page opens, such as a diagram's lightbox, isn't the page's content.
function keepOnly(parent, kept) {
  for (const child of parent.children)
    if (!child.matches("dialog, [popover], summary"))
      hide(child, !kept.has(child));
}
// A thread on a whole page has no block, and the frame puts its card at the end.
function onWholePage(card) {
  const thread = (remote?.threads ?? []).find(
    (item) => item.id === card.dataset.thread,
  );
  return thread && !thread.target && !thread.quote;
}
function showBlock(element, root) {
  for (let at = element; at !== root; at = at.parentElement)
    if (at.tagName === "DETAILS") at.open = true;
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
  const page = wanted && targetElement(wanted);
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
function arrived(row, id) {
  if (id === "work") return !$("work-view").hidden;
  if (id === "feedback") return !$("review-view").hidden;
  return (
    (!row.round || plan.round === row.round) &&
    page.id === id &&
    !page.pending &&
    $("page-content").dataset.pageId === id
  );
}
async function whenArrived(row, { page: id, target }) {
  const limit = Date.now() + ARRIVE_LIMIT_MS;
  while (
    wanted === target &&
    Date.now() < limit &&
    !arrived(row, id || "agreed")
  )
    await new Promise((done) => setTimeout(done, ARRIVE_POLL_MS));
}
/* A note or answer's words are the reader's own, so its block doesn't hold them.
   It shows the block under the card that holds them. A note on a whole page has
   no block, and shows its card on the Feedback page. */
async function sentPlace(row) {
  const sent = row.kind === "notes" || row.kind === "answers";
  if (!sent || row.draft || !row.round || !row.page) return null;
  const response = await fetch(
    `${base}/api/submission?round=${encodeURIComponent(row.round)}`,
  );
  const submission = response.ok ? (await response.json()).submission : null;
  const entry = sentEntries(submission).find(({ id }) => id === row.item);
  if (!entry) return null;
  const note = submission.groups.notes?.find(({ id }) => id === row.item);
  const target = note
    ? note.target
    : `control-${row.item.slice(row.page.length + 1)}`;
  return target ? { page: row.page, target, entry } : null;
}
/* The result on screen stays until the next one is ready, as a page stays until
   the next page has drawn. The copy's stylesheets can't see the root's data-embed,
   so what those rules hide comes out of the copy here. */
function holdPicture() {
  if (!onScreen || picture) return;
  const padding = getComputedStyle($("content")).padding;
  const whole = document.documentElement.hasAttribute("data-embed-whole");
  picture = copyColumn((copy) => {
    copy.style.padding = padding;
    copy.style.maxWidth = "none";
    for (const part of copy.querySelectorAll(
      `.${HIDE}, .note-count, .page-footer, .sent-page-comments, .history-strip${whole ? "" : ", #page-title"}`,
    ))
      part.remove();
  });
}
function dropPicture() {
  picture?.remove();
  picture = null;
}
async function whenReady() {
  const limit = Date.now() + READY_LIMIT_MS;
  await whenLanded(limit);
  while (
    Date.now() < limit &&
    (renders.size || "drawing" in $("page-content").dataset)
  )
    await new Promise((done) => setTimeout(done, ARRIVE_POLL_MS));
}
function placeSent(entry) {
  document.getElementById("embed-sent")?.remove();
  if (!entry) return;
  const card = sentCard(entry);
  card.id = "embed-sent";
  $("page-content").before(card);
}
function pause() {
  for (const media of document.querySelectorAll("video, audio")) media.pause();
}
export function installEmbed() {
  document.documentElement.dataset.embed = "";
  // A link that leaves the block opens in the reader's tab, on the real page.
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link || link.target === "_blank") return;
      const url = new URL(link.href);
      if (url.hash && document.getElementById(url.hash.slice(1))) return;
      event.preventDefault();
      // A link to a page resolves against this frame's own address.
      if (url.pathname === location.pathname) {
        url.pathname = `${base}/`;
        url.search = "";
      }
      window.top.location.assign(url.href);
    },
    true,
  );
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
      showing = true;
      const asked = ++opens;
      holdPicture();
      const sent = await sentPlace(row);
      if (asked !== opens) return;
      const place = sent ?? { page: pageOf(row), target: targetOf(row) };
      wanted = place.target;
      await ensurePageSet();
      if (asked !== opens) return;
      const match = query.trim();
      // A read-only frame has one round, so it never has to change round.
      if (row.round && editable) openResult(row, query, place);
      else show(place.page || "agreed", place.target, { match });
      await whenArrived(row, place);
      if (asked !== opens) return;
      placeSent(sent?.entry);
      isolate();
      await whenReady();
      if (asked !== opens) return;
      dropPicture();
    },
    show(on) {
      showing = on;
      onScreen = on;
      if (!on) pause();
    },
    // Closing the search window leaves the frame loaded and idle.
    pause() {
      showing = false;
      pause();
    },
    theme: useTheme,
  };
}
