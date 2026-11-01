import { $ } from "#frame/app/util.mjs";
import { base, editable, page, plan } from "#frame/app/view.mjs";
import { targetElement, whenLanded } from "#frame/notes/match.mjs";
import { show } from "#frame/pages/pages.mjs";
import { copyColumn } from "#frame/pages/progress.mjs";
import { renders, useTheme } from "#frame/pages/renderers.mjs";
import { sentCard, sentEntries } from "#frame/review/review.mjs";
import { openResult, pageOf, targetOf } from "#frame/search/open.mjs";
import { ensurePageSet } from "#frame/sync/rounds.mjs";

/* The session's real frame, inside the search window. It goes to a result the
   way Open does, through the page's own code, so the reader sees the real page
   at their words. */
const ARRIVE_LIMIT_MS = 15000;
const ARRIVE_POLL_MS = 20;
// A page that never settles still shows, once the reader has waited this long.
const READY_LIMIT_MS = 8000;
const CARD_GAP_PX = 12;

let wanted = null;
let opens = 0;
let showing = true;
let onScreen = false;
let picture = null;
export const embedShowing = () => showing;

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
   Its page shows at the block, under the card that holds them. A note on a whole
   page has no block, and shows its card on the Feedback page. */
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
  picture = copyColumn((copy) => {
    copy.style.padding = padding;
    copy.style.maxWidth = "none";
    for (const part of copy.querySelectorAll(
      "#agent-activity, #finished-line, .note-count, .page-footer, .history-strip",
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
// The reader's words are in the card, so nothing else moves the page to the block.
function showUnderCard(target) {
  const block = targetElement(target);
  if (!block) return;
  const card = document.getElementById("embed-sent");
  block.style.scrollMarginTop = `${card.offsetHeight + CARD_GAP_PX}px`;
  block.scrollIntoView({ block: "start", behavior: "instant" });
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
      await whenReady();
      if (asked !== opens) return;
      if (sent) showUnderCard(sent.target);
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
