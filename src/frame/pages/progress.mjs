import { scroller } from "#frame/app/places.mjs";
import { $ } from "#frame/app/util.mjs";

/* A move the reader makes changes the header and the sidebar at the click,
   and the reading column once the new page is complete. Until then the
   column keeps the previous page. If the new page is not complete 200 ms
   after the click, a thin bar draws along the top of the column at a pace
   that would fill it in 3 s, and waits at 90%. When the page is complete,
   a move that showed the bar crossfades to it over 1 s while the bar fades
   out at the same pace; a quicker move swaps at once.

   A move to another page of the frame, such as another session or a
   notification's link, is a page load. The old page leaves the time of the
   click in sessionStorage and names its scrolling pane for the browser's
   view transition, which keeps a picture of the whole previous page on
   screen. The new page swaps all of it at once when its header, sidebar and
   page are complete. If the page takes longer than 200 ms, the header and
   sidebar change then, with the bar, and the column waits as it would
   within a page. */
const DELAY_MS = 200;
const FULL_MS = 3000;
const HOLD = 0.9;
const FADE_MS = 1000;
// A move that never completes, such as one whose page fails to load, ends
// after this long, as develop's limit for figures that never draw does.
const LIMIT_MS = 10000;
const CLICK_KEY = "pair-move-at";
let lastInput = 0;
let movingSince = null;
let bar = null;
let grow = null;
let picture = null;
let fading = null;
let drawnOnce = false;
let limit = null;
// A page load from another page of the frame, whose view transition holds
// pictures of the previous page until settle() lets them go.
let crossing = false;
let loadedAt = 0;
let chromeDrawn = false;
let fadeColumn = false;
let looked = 0;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function stored(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* Without storage, a move into another session counts from its load. */
  }
  return null;
}
export function installProgress() {
  const input = () => (lastInput = Date.now());
  document.addEventListener("click", input, true);
  document.addEventListener("keydown", input, true);
  window.addEventListener("pagehide", () =>
    stored(
      CLICK_KEY,
      String(Date.now() - lastInput < 1000 ? lastInput : Date.now()),
    ),
  );
  window.addEventListener("pageswap", (event) => depart(event.viewTransition));
  bar = document.createElement("div");
  bar.className = "move-bar";
  bar.setAttribute("aria-hidden", "true");
  document.querySelector(".main-column").prepend(bar);
  // A recent click on the old page starts this page's move. Only a page
  // load from another page of the frame has the browser's pictures to
  // release, and settle() stops looking for them after a few frames.
  const at = Number(stored(CLICK_KEY));
  stored(CLICK_KEY, null);
  const recent = at && Date.now() - at < 5000;
  crossing = true;
  loadedAt = recent ? at : Date.now();
  if (recent) beginMove(at);
  requestAnimationFrame(settle);
}
// The copy keeps every id, so the styles scoped to #page-content still
// reach it. It sits behind a closed shadow root with copies of the page's
// stylesheets, where no lookup in the document finds it.
function copyColumn() {
  const column = $("content");
  const pane = scroller().getBoundingClientRect();
  const box = column.getBoundingClientRect();
  const frame = document.createElement("div");
  frame.inert = true;
  frame.style.cssText = `position:fixed;overflow:hidden;pointer-events:none;background:var(--panel);left:${pane.left}px;top:${pane.top}px;width:${pane.width}px;height:${pane.height}px`;
  const copy = column.cloneNode(true);
  copy.style.cssText = `position:absolute;left:${box.left - pane.left}px;top:${box.top - pane.top}px;width:${box.width}px;height:${box.height}px`;
  const canvases = copy.querySelectorAll("canvas");
  column.querySelectorAll("canvas").forEach((canvas, index) => {
    canvases[index].getContext("2d")?.drawImage(canvas, 0, 0);
  });
  const sheets = document.head.querySelectorAll("style, link[rel=stylesheet]");
  frame
    .attachShadow({ mode: "closed" })
    .append(...[...sheets].map((sheet) => sheet.cloneNode(true)), copy);
  document.body.append(frame);
  return frame;
}
// The bar's animation starts at the click with a delay, so the browser
// shows it on time even while the page is busy drawing. The bar's own
// opacity is 0, and the animation's frames are opaque.
function startBar() {
  bar.getAnimations().forEach((animation) => animation.cancel());
  const delay = Math.max(0, movingSince + DELAY_MS - Date.now());
  const from = reduced() ? HOLD : 0;
  grow = bar.animate(
    [
      { transform: `scaleX(${from})`, opacity: 1 },
      { transform: `scaleX(${HOLD})`, opacity: 1 },
    ],
    {
      delay,
      duration: reduced() ? 1 : FULL_MS * HOLD,
      easing: "linear",
      fill: "forwards",
    },
  );
}
// The bar is on screen once its delay has passed.
function barShown() {
  return grow?.effect.getComputedTiming().progress != null;
}
function finishBar(shown) {
  const growing = grow;
  grow = null;
  if (!growing) return;
  if (!shown || reduced()) return growing.cancel();
  const reached = growing.effect.getComputedTiming().progress * HOLD;
  growing.cancel();
  // The bar keeps its pace while it fades out, so the finish never jumps.
  bar.animate(
    [
      { transform: `scaleX(${reached})`, opacity: 1 },
      {
        transform: `scaleX(${Math.min(1, reached + FADE_MS / FULL_MS)})`,
        opacity: 0,
      },
    ],
    { duration: FADE_MS, easing: "linear" },
  );
}
// show() calls this before it replaces the page. A move already under way
// keeps its bar and its picture of the page the reader left.
export function beginMove(at = null) {
  if (movingSince !== null) return;
  // A move during a crossfade ends it where it is.
  fading?.remove();
  fading = null;
  $("page-content")
    .getAnimations()
    .forEach((animation) => animation.cancel());
  movingSince = at ?? (Date.now() - lastInput < 1000 ? lastInput : Date.now());
  if (drawnOnce) picture = copyColumn();
  startBar();
  limit = setTimeout(arrived, LIMIT_MS);
}
// show() calls this once the page on screen is complete.
export function arrived() {
  drawnOnce = true;
  if (movingSince === null) return;
  movingSince = null;
  clearTimeout(limit);
  const shown = barShown();
  const fade = shown && !reduced();
  const leaving = picture;
  picture = null;
  fadeColumn = fade;
  if (fade) crossfade(leaving);
  else leaving?.remove();
  finishBar(shown);
  // A page load lets the previous page go in the same frame.
  settle(false);
}
function crossfade(leaving) {
  const timing = { duration: FADE_MS, easing: "ease-in-out" };
  $("page-content").animate([{ opacity: 0 }, { opacity: 1 }], timing);
  if (!leaving) return;
  fading = leaving;
  leaving.animate([{ opacity: 1 }, { opacity: 0 }], {
    ...timing,
    fill: "forwards",
  }).onfinish = () => {
    leaving.remove();
    if (fading === leaving) fading = null;
  };
}
// An open popover or dialog, and the floating comment button, are in the
// root's picture, under the column's, which would cover part of them, so
// each gets a picture of its own above.
const LAYERS = 5;
function depart(leaving) {
  if (!leaving) return;
  (picture || scroller()).style.viewTransitionName = "reading";
  [
    ...document.querySelectorAll(
      ":popover-open, dialog[open], #quote:not([hidden])",
    ),
  ]
    .slice(0, LAYERS)
    .forEach((layer, index) => {
      layer.style.viewTransitionName = `layer-${index}`;
      // A modal dialog's backdrop belongs to the root's picture, under the
      // column's, so the dialog draws it as its own shadow instead.
      if (!layer.matches(":modal")) return;
      const dim = getComputedStyle(layer, "::backdrop").backgroundColor;
      layer.style.boxShadow = `0 0 0 100vmax ${dim}`;
      layer.dataset.leaving = "";
    });
}
// The pictures of the previous page's popovers and dialogs go with its
// header and sidebar.
function hideLayers() {
  for (let index = 0; index < LAYERS; index++)
    document.documentElement.animate([{ opacity: 0 }, { opacity: 0 }], {
      duration: 1,
      fill: "forwards",
      pseudoElement: `::view-transition-old(layer-${index})`,
    });
}
function held(name) {
  return document
    .getAnimations()
    .find((animation) => animation.effect?.pseudoElement === name);
}
// boot calls this once the first poll has drawn the header and sidebar.
export function chromeReady() {
  chromeDrawn = true;
  settle(false);
}
// On a page load, lets the browser's pictures of the previous page go: all
// at once when the header, the sidebar and the page are complete, or the
// header and sidebar alone once the page has taken 200 ms. The transition
// starts with this page's first frames, so a load without one stops after
// a few frames.
function settle(next = true) {
  if (!crossing) return;
  const chrome = held("::view-transition-new(root)");
  const column = held("::view-transition-old(reading)");
  if (!chrome && !column) {
    if (!next) return;
    if (++looked > 30) crossing = false;
    else requestAnimationFrame(() => settle());
    return;
  }
  const waited = Date.now() - loadedAt;
  // In case the first poll never finishes.
  const drawn = chromeDrawn || waited > 1000;
  const complete = movingSince === null;
  if (
    drawn &&
    (complete || waited >= DELAY_MS) &&
    chrome?.playState === "running"
  ) {
    chrome.finish();
    hideLayers();
  }
  if ((drawn && complete) || waited > LIMIT_MS) {
    crossing = false;
    endColumn(column, complete && fadeColumn);
    return;
  }
  if (next) requestAnimationFrame(() => settle());
}
// The transition ends a frame after its last animation does, so a picture
// that must go at once is hidden in the same frame instead of left to end.
function endColumn(hold, fade) {
  if (!hold) return;
  hold.cancel();
  // A new animation shows its first keyframe in the frame it starts.
  const from = fade ? 1 : 0;
  document.documentElement.animate([{ opacity: from }, { opacity: 0 }], {
    duration: fade ? FADE_MS : 1,
    easing: "ease-in-out",
    fill: "forwards",
    pseudoElement: "::view-transition-old(reading)",
  });
}
