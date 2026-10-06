import { record } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import { editable, pastRound, placeKey, shownPage } from "#frame/app/view.mjs";
import { displayedRound } from "#frame/pages/pages.mjs";
import { renders } from "#frame/pages/renderers.mjs";
import { selectedTab } from "#frame/sync/rounds.mjs";

// Where the reader was in each round: the last page, and on every page they
// read, the block they were reading and how far into it. Also which tab and
// past round were on screen.
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
export const placeIn = (round, pageIds) => placeFor(places, round, pageIds);
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
const shownView = () =>
  ({ work: $("work-view"), feedback: $("review-view") })[shownPage()] ||
  $("reading");
/* The block the reader is reading: of the elements with an ID in the view on
   screen, the one whose top is nearest the top of the scrolling area, unless
   it is wholly above it. into is how far its top is above that edge. At the
   top of the page there is none. */
function readingAt() {
  const box = scroller();
  if (box.scrollTop < 1) return null;
  const edge = box.getBoundingClientRect().top;
  let found = null;
  for (const element of shownView().querySelectorAll("[id]")) {
    // A diagram's drawing names its parts anew each time it draws.
    if (element.closest("svg")) continue;
    const { top, bottom, height } = element.getBoundingClientRect();
    if (!height || bottom <= edge) continue;
    if (!found || Math.abs(edge - top) < Math.abs(found.into))
      found = { id: element.id, into: edge - top };
  }
  return found && { id: found.id, into: Math.round(found.into) };
}
/* Each round's place, so switching tabs, picking a round from the clock, a
   reload, and the bell's jump to another session and back all land on the
   page and the block the reader left. A round not visited has no entry,
   which starts it at its first page. Only the live reader stores them, so a
   read-only page cannot overwrite its tabs. The place is noted 250ms after
   the last scroll, before the frame shows another page, and when the
   document unloads. */
let placeTimer = 0;
export function rememberPlace() {
  clearTimeout(placeTimer);
  placeTimer = setTimeout(notePlace, 250);
}
// Notes the place a scroll left unnoted.
export function flushPlace() {
  if (placeTimer) notePlace();
}
function notePlace() {
  clearTimeout(placeTimer);
  placeTimer = 0;
  const pageId = shownPage();
  const at = { ...places[displayedRound]?.at };
  // While a landing holds an anchor that is not on the page yet, the place
  // the reader had stays.
  const spot = held ? held.spot() : readingAt();
  if (spot) at[pageId] = spot;
  else if (spot === null) delete at[pageId];
  places[displayedRound] = { page: pageId, at };
  savePlaces();
}
export function savePlaces() {
  if (!editable) return;
  try {
    localStorage.setItem(
      placeKey,
      JSON.stringify({ tab: selectedTab, past: pastRound, places }),
    );
  } catch {
    /* Returning to the same place is a convenience, not a requirement. */
  }
}
// What a re-render of the page on screen keeps: the anchor a landing still
// holds, or else the block the reader is reading.
export const placeOnScreen = () => (held ? held.anchor() : readingAt());
// The anchor an arrival lands on when the address and the bell name none.
export const savedPlace = () => places[displayedRound]?.at?.[shownPage()];

/* land() decides where the page on screen opens. Its anchor is one of:
   - { target }, the ID of a reply, block or section that the address, the
     bell or a link names, which lands in the middle of the scrolling area,
     or at its top when it is taller, and takes focus;
   - { id, into }, the block the reader was reading, with into pixels of it
     above the top of the scrolling area;
   - null, the top.
   What is above the anchor can still change height once the page shows: a
   code block highlights, an image loads, a diagram draws, a thread's card
   is placed or cut short. Until the reader scrolls, taps or types, or
   nothing in the view has changed size for QUIET_MS, each change scrolls
   the anchor back to its place, and so does any scroll the reader did not
   make, such as the browser's own jump to the address's # part at load.
   The count starts once the tracked renderers and the view's images have
   settled, for up to WAIT_MS, because an image has no height until it
   loads and a screenshot can take longer than QUIET_MS. The browser's
   scroll anchoring is off meanwhile, because it keeps whatever is at the
   top of the area in place.
   An anchor that is not on the page yet, such as a reply whose card the
   first status poll places, lands once it appears, for up to WAIT_MS, and
   the page stays where it is meanwhile.
   Focus moves to a target, and to the page's heading for any other anchor
   unless focusHeading is false. While the landing holds a target, focus that
   drops to no element goes back to it: the browser clears focus at load
   when the element the # part names cannot take it. */
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
    if (focusHeading) heading().focus({ preventScroll: true });
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
      if (document.activeElement === document.body && element?.isConnected)
        element.focus({ preventScroll: true });
    });
  // A target is opened and focused when it is found, and again when a
  // render replaces it, and measured the first time.
  function arrive(next) {
    element?.removeEventListener("blur", refocus);
    element = next;
    if (!target) return;
    for (let at = element; at; at = at.parentElement)
      if (at.tagName === "DETAILS") at.open = true;
    // A collapsed card shows only its head, so a reply inside it has no box
    // until the card expands, as its Expand button does.
    element
      .closest("pair-thread[collapsed]")
      ?.querySelector(".thread-fold")
      .click();
    if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
    element.focus({ preventScroll: true });
    element.addEventListener("blur", refocus);
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
    // The place to note: the anchor as it stands, or undefined while it is
    // not on the page.
    spot,
    anchor: () => ({ ...anchor, ...(into === null ? {} : { into }) }),
  };
  box.style.overflowAnchor = "none";
  if (focusHeading && !(target && find()))
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
}
