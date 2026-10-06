import { record } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  editable,
  page,
  pastRound,
  placeKey,
  shownPage,
} from "#frame/app/view.mjs";
import { displayedRound } from "#frame/pages/pages.mjs";
import { renders } from "#frame/pages/renderers.mjs";
import { selectedTab } from "#frame/sync/rounds.mjs";

// Where the reader was in each round: the last page, and the scroll
// position on every page they read. Also which tab and past round were on
// screen.
export function readPlaces(saved) {
  const places = {};
  const offset = (value) => {
    const top = Number(value);
    return Number.isFinite(top) && top > 0 ? top : 0;
  };
  const place = (value) => {
    const tops = {};
    if (record(value.tops))
      for (const [id, top] of Object.entries(value.tops))
        if (offset(top)) tops[id] = offset(top);
    return { page: value.page, top: offset(value.top), tops };
  };
  if (!record(saved)) return { tab: "current", past: null, places };
  if (record(saved.places))
    for (const [round, value] of Object.entries(saved.places))
      if (record(value) && typeof value.page === "string")
        places[round] = place(value);
  return {
    tab: saved.tab === "past" ? "past" : "current",
    past: typeof saved.past === "string" ? saved.past : null,
    places,
  };
}
// A remembered page that the round no longer has is ignored.
export function placeFor(places, round, pageIds) {
  const place = places[round];
  return place && pageIds.includes(place.page) ? place : null;
}
export let places = {};
export function loadPlaces() {
  let placeStore = { tab: "current", past: null, places: {} };
  try {
    placeStore = readPlaces(JSON.parse(localStorage.getItem(placeKey)));
  } catch {
    /* Every round then opens at its first page. */
  }
  places = placeStore.places;
  return placeStore;
}
/* Above 720px main scrolls and the sidebar stays; below it the body does. */
export const scroller = () =>
  [document.querySelector("main"), document.querySelector(".app-body")].find(
    (el) => /auto|scroll/.test(getComputedStyle(el).overflowY),
  );
/* Where you were in each round, so switching tabs, picking a round from
   the clock, a reload, and the bell's jump to another session and back all
   land on the page and scroll position you left. A round you have not
   visited has no entry, which starts it at its first page. Only the live
   reader stores them, so a read-only page cannot overwrite its tabs. */
let placeTimer = 0;
export function rememberPlace() {
  const pageId = shownPage();
  const round = displayedRound;
  const held = restoring?.round === round && restoring.page === pageId;
  // A place above Agreed's content is the page's top, as a stored place is,
  // because what is above the content can be taller when the reader returns.
  const top = held
    ? restoring.top
    : Math.max(0, Math.round(scroller().scrollTop) - aboveAgreed());
  places[round] = {
    page: pageId,
    top,
    tops: { ...places[round]?.tops, [pageId]: top },
  };
  savePlaces();
}
export function savePlaces() {
  if (!editable) return;
  clearTimeout(placeTimer);
  placeTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        placeKey,
        JSON.stringify({ tab: selectedTab, past: pastRound, places }),
      );
    } catch {
      /* Returning to the same place is a convenience, not a requirement. */
    }
  }, 250);
}
export const placeIn = (round, pageIds) => placeFor(places, round, pageIds);
/* A page can still be loading, or its renderers can still change its height,
   when the reader returns to it, and the browser clamps the position
   meanwhile. Until the page settles, the position being restored stands in
   for the clamped one. */
export let restoring = null;
/* The height each page had when the reader left it. Returning holds that
   height while the page's renderers work, so the browser does not clamp the
   position and then jump when they finish. */
const heights = new Map();
const shownBody = () =>
  ({ work: $("work-view"), feedback: $("review-view") })[shownPage()] ||
  $("page-content");
export function rememberHeight() {
  const pageId = shownPage();
  if (restoring?.round === displayedRound && restoring.page === pageId) return;
  heights.set(`${displayedRound}:${pageId}`, shownBody().offsetHeight);
}
export function endRestore() {
  restoring = null;
  $("page-content").style.minHeight = "";
  $("review-view").style.minHeight = "";
  $("work-view").style.minHeight = "";
}
export function restoreScroll(top) {
  endRestore();
  restoring = {
    round: displayedRound,
    page: shownPage(),
    top,
  };
  const height = heights.get(`${restoring.round}:${restoring.page}`);
  if (height) shownBody().style.minHeight = `${height}px`;
  settleScroll();
}
// The activity component and the finished line sit above Agreed's content
// and come and go with the round, so Agreed's place is kept relative to the
// content below them.
function aboveAgreed() {
  if (page.id !== "agreed" || $("reading").hidden) return 0;
  const title = $("page-title");
  return $("note-bars").offsetTop - title.offsetTop - title.offsetHeight;
}
export function settleScroll() {
  const target = restoring;
  if (!target) return;
  scroller().scrollTo(0, target.top + aboveAgreed());
  Promise.allSettled([...renders]).then(() => {
    if (restoring !== target) return;
    scroller().scrollTo(0, target.top + aboveAgreed());
    if ($("reading").hidden || !page.pending) endRestore();
  });
}
/* What is above a target can still change height after the scroll to it:
   an image gets its height only once it loads, and a long reply is cut
   short once its images have one. The browser's scroll anchoring does not
   keep the target in place through that. It follows content that an image
   pushes down inside a cut reply, and it does not undo its move when the
   reply is then cut. So until the reader scrolls, taps or presses a key, or
   HOLD_MS pass, anchoring is off and every change in the size of the
   target's view scrolls to the target again.
   The target keeps focus for as long. Once a page loads, the browser
   focuses the element whose ID the address's # part names, such as a
   heading that a page gives the page's own ID, and clears focus when that
   element cannot take it, so focus that leaves the target for no element
   goes back to it. */
const HOLD_MS = 10000;
const readerInputs = ["wheel", "touchstart", "pointerdown", "keydown"];
let release = () => {};
export function holdInView(target, view) {
  release();
  const box = scroller();
  const observer = new ResizeObserver(() => {
    if (target.isConnected && target.getClientRects().length)
      target.scrollIntoView({ block: "center" });
    else stop();
  });
  const refocus = () =>
    queueMicrotask(() => {
      if (document.activeElement === document.body && target.isConnected)
        target.focus({ preventScroll: true });
    });
  let timer;
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
    box.style.overflowAnchor = "";
    target.removeEventListener("blur", refocus);
    for (const type of readerInputs) removeEventListener(type, stop, true);
    release = () => {};
  }
  release = stop;
  timer = setTimeout(stop, HOLD_MS);
  box.style.overflowAnchor = "none";
  target.addEventListener("blur", refocus);
  for (const type of readerInputs)
    addEventListener(type, stop, { capture: true, passive: true });
  observer.observe(view);
}
export function installPlaces() {
  document.addEventListener("scroll", rememberHeight, true);
  document.addEventListener("scroll", rememberPlace, true);
}
