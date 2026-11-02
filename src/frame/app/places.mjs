import { record } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  editable,
  embedded,
  pastRound,
  placeKey,
  shownPage,
} from "#frame/app/view.mjs";
import { displayedRound } from "#frame/pages/pages.mjs";
import { renders } from "#frame/pages/renderers.mjs";

// The saved value contains, for each round, the last page the reader was on
// and, for each page they read, the block they were reading and how far into
// it. It also contains the past round the left tab shows.
export function readPlaces(saved) {
  const places = {};
  const spot = (value) =>
    record(value) &&
    typeof value.id === "string" &&
    value.id &&
    Number.isFinite(value.into)
      ? { id: value.id, into: Math.round(value.into) }
      : null;
  const place = (value) => {
    const at = {};
    if (record(value.at))
      for (const [id, saved] of Object.entries(value.at))
        if (spot(saved)) at[id] = spot(saved);
    return { page: value.page, at };
  };
  if (!record(saved)) return { past: null, places };
  if (record(saved.places))
    for (const [round, value] of Object.entries(saved.places))
      if (record(value) && typeof value.page === "string")
        places[round] = place(value);
  return {
    past: typeof saved.past === "string" ? saved.past : null,
    places,
  };
}
export function placeFor(places, round, pageIds) {
  const place = places[round];
  return place && pageIds.includes(place.page) ? place : null;
}
export let places = {};
export const placeIn = (round, pageIds) => placeFor(places, round, pageIds);
export function loadPlaces() {
  let placeStore = { past: null, places: {} };
  try {
    placeStore = readPlaces(JSON.parse(localStorage.getItem(placeKey)));
  } catch {
    /* When localStorage throws, every round opens at its first page. */
  }
  places = placeStore.places;
  if (!embedded) {
    resumed = takeReloadPlace();
    resumedTab = resumed?.page === "work" ? resumed.workTab : null;
  }
  return placeStore;
}
/* Above 720px main scrolls, and at 720px and below .app-body scrolls. */
export const scroller = () =>
  [document.querySelector("main"), document.querySelector(".app-body")].find(
    (el) => /auto|scroll/.test(getComputedStyle(el).overflowY),
  );
const shownView = () =>
  ({ work: $("work-view"), feedback: $("review-view") })[shownPage()] ||
  $("reading");
/* readingAt() returns the block the reader is reading: the element with an
   ID in the view on screen whose top is nearest the top of the scrolling
   area, unless the element is wholly above it. into is how far the
   element's top is above that edge. At the top of the page readingAt()
   returns null. */
function readingAt() {
  const box = scroller();
  if (box.scrollTop < 1) return null;
  const edge = box.getBoundingClientRect().top;
  let found = null;
  for (const element of shownView().querySelectorAll("[id]")) {
    // A diagram gives the parts of its SVG new IDs each time it draws.
    if (element.closest("svg")) continue;
    const { top, bottom, height } = element.getBoundingClientRect();
    if (!height || bottom <= edge) continue;
    if (!found || Math.abs(edge - top) < Math.abs(found.into))
      found = { id: element.id, into: edge - top };
  }
  return found && { id: found.id, into: Math.round(found.into) };
}
/* The frame saves each round's place, so switching tabs, picking a round
   from the clock, a reload, and the bell's jump to another session and back
   all return to the page and the block the reader left. A round with no
   entry opens at its first page. savePlaces() saves only for the live
   reader, so a read-only page cannot overwrite the left tab's round.
   notePlace() runs 250ms after the last scroll, before the frame shows
   another page, and when the document unloads. */
let placeTimer = 0;
export function rememberPlace() {
  clearTimeout(placeTimer);
  placeTimer = setTimeout(notePlace, 250);
}
export function flushPlace() {
  if (placeTimer) notePlace();
}
function notePlace() {
  clearTimeout(placeTimer);
  placeTimer = 0;
  const pageId = shownPage();
  const at = { ...places[displayedRound]?.at };
  // held.spot() returns undefined while its anchor is not on the page yet,
  // and then the saved place for the page stays as it was.
  const spot = held ? held.spot() : readingAt();
  if (spot) at[pageId] = spot;
  else if (spot === null) delete at[pageId];
  places[displayedRound] = { page: pageId, at };
  savePlaces();
}
export function savePlaces() {
  if (!editable || embedded) return;
  try {
    localStorage.setItem(placeKey, JSON.stringify({ past: pastRound, places }));
  } catch {
    /* When localStorage throws, the frame works without saved places. */
  }
}
export const placeOnScreen = () => (held ? held.anchor() : readingAt());
// A result's words scroll themselves into view once the page has landed.
export const stopLanding = () => held?.stop();
export const savedPlace = () =>
  resumed?.round === displayedRound && resumed.page === shownPage()
    ? resumed.spot
    : places[displayedRound]?.at?.[shownPage()];
/* The tab's reload on a new hub returns to the block on screen, which the saved
   places can't do: a read-only page saves none, and a round opened from the
   address starts at the top of its page. The kept anchor stands in for the
   address's target and match, which would land somewhere else. A load can show
   the page more than once before the first status settles which tab it is on,
   so the anchor lasts until the reader's first input. */
const RELOAD_PLACE = "pair:reload-place";
let resumed = null;
let resumedTab = null;
export function keepPlaceOverReload(workTab) {
  sessionStorage.setItem(
    RELOAD_PLACE,
    JSON.stringify({
      round: displayedRound,
      page: shownPage(),
      spot: placeOnScreen(),
      workTab,
    }),
  );
  const url = new URL(location.href);
  url.searchParams.delete("target");
  url.searchParams.delete("match");
  history.replaceState(null, "", url);
}
// A reload on Work opens the tab the reader was on, and any other load opens the
// first tab with a card in it.
export function resumedWorkTab() {
  const tab = resumedTab;
  resumedTab = null;
  return tab;
}
function takeReloadPlace() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RELOAD_PLACE));
    sessionStorage.removeItem(RELOAD_PLACE);
    return saved;
  } catch {
    return null;
  }
}

/* land() scrolls the page on screen to an anchor, which is one of these:
   - { target }, the ID of a reply, block or section from the address, the
     bell or a link. land() puts it in the middle of the scrolling area, or
     at the top when it is taller, and focuses it.
   - { id, into }, the block the reader was reading, with into pixels of it
     above the top of the scrolling area.
   - null, the top of the page.
   Content above the anchor can change height after the page shows: a code
   block highlights, an image loads, a diagram draws, or a thread's card is
   placed or cut short. land() scrolls the anchor back to its place after
   each change, and after any scroll the reader did not make, such as the
   browser's jump to the address's # part at load. It stops when the reader
   scrolls, taps or types, or when nothing in the view has changed size for
   QUIET_MS. That count starts after the tracked renderers and the view's
   images settle, or after WAIT_MS, because an image has no height until it
   loads and a screenshot can take longer than QUIET_MS. land() turns off
   the browser's scroll anchoring meanwhile, because the browser would keep
   whatever is at the top of the area in place.
   When the anchor is not on the page yet, such as a reply whose card the
   first status poll places, land() waits up to WAIT_MS for it to appear
   and leaves the page where it is meanwhile.
   land() focuses a target, and the page's heading for any other anchor
   unless focusHeading is false. While land() is placing a target,
   refocus() returns focus to it when focus drops to no element, because
   the browser clears focus at load when the element that the # part names
   is not focusable. */
const QUIET_MS = 1000;
const WAIT_MS = 10000;
const readerInputs = ["wheel", "touchstart", "pointerdown", "keydown"];
let held = null;
const heading = () =>
  (
    ({ work: $("work-view"), feedback: $("review-view") })[shownPage()] ||
    $("reading")
  ).querySelector("h1");
export function land(anchor, { focusHeading = true } = {}) {
  held?.stop();
  const box = scroller();
  const view = shownView();
  const id = anchor?.target ?? anchor?.id;
  if (!id) {
    box.scrollTop = 0;
    if (focusHeading && !embedded) heading().focus({ preventScroll: true });
    notePlace();
    return;
  }
  const target = Boolean(anchor.target);
  let into = Number.isFinite(anchor.into) ? anchor.into : null;
  let element = null;
  let quiet = 0;
  let settled = false;
  const find = () => view.querySelector(`[id="${CSS.escape(id)}"]`);
  const refocus = () =>
    queueMicrotask(() => {
      if (
        !embedded &&
        document.activeElement === document.body &&
        element?.isConnected
      )
        element.focus({ preventScroll: true });
    });
  function arrive(next) {
    element?.removeEventListener("blur", refocus);
    element = next;
    if (!target) return;
    for (let at = element; at; at = at.parentElement)
      if (at.tagName === "DETAILS") at.open = true;
    // A reply inside a collapsed card has no box, so arrive() clicks the
    // card's Expand button, .thread-fold.
    element
      .closest("pair-thread[collapsed]")
      ?.querySelector(".thread-fold")
      .click();
    if (!embedded) {
      if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
      element.focus({ preventScroll: true });
      element.addEventListener("blur", refocus);
    }
    if (into === null)
      into = -Math.max(
        0,
        (box.clientHeight - element.getBoundingClientRect().height) / 2,
      );
  }
  function place() {
    if (!element?.isConnected) {
      const next = find();
      if (!next) return;
      arrive(next);
    }
    const edge = box.getBoundingClientRect().top;
    const off = element.getBoundingClientRect().top - (edge - into);
    if (Math.abs(off) >= 1) box.scrollTop += off;
  }
  function changed() {
    place();
    clearTimeout(quiet);
    if (settled && element) quiet = setTimeout(stop, QUIET_MS);
  }
  const observer = new ResizeObserver(changed);
  const waiting = setTimeout(() => element || stop(), WAIT_MS);
  function stop() {
    observer.disconnect();
    clearTimeout(quiet);
    clearTimeout(waiting);
    box.style.overflowAnchor = "";
    box.removeEventListener("scroll", place);
    element?.removeEventListener("blur", refocus);
    for (const type of readerInputs) removeEventListener(type, stop, true);
    if (held?.stop === stop) held = null;
  }
  const spot = () =>
    element?.isConnected && into !== null ? { id, into } : undefined;
  held = {
    stop,
    spot,
    anchor: () => ({ ...anchor, ...(into === null ? {} : { into }) }),
  };
  box.style.overflowAnchor = "none";
  if (focusHeading && !embedded && !(target && find()))
    heading().focus({ preventScroll: true });
  place();
  box.addEventListener("scroll", place, { passive: true });
  for (const type of readerInputs)
    addEventListener(type, stop, { capture: true, passive: true });
  observer.observe(view);
  const images = [...view.querySelectorAll("img")]
    .filter((image) => !image.complete)
    .map(
      (image) =>
        new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        }),
    );
  void Promise.race([
    Promise.allSettled([...renders, ...images]),
    new Promise((resolve) => setTimeout(resolve, WAIT_MS)),
  ]).then(() => {
    settled = true;
    if (held?.stop === stop) changed();
  });
  notePlace();
}
export function installPlaces() {
  document.addEventListener("scroll", rememberPlace, true);
  addEventListener("pagehide", flushPlace);
  for (const type of readerInputs)
    addEventListener(type, () => (resumed = null), {
      capture: true,
      passive: true,
      once: true,
    });
}
