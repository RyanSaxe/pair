import { stopLanding } from "#frame/app/places.mjs";
import { $ } from "#frame/app/util.mjs";
import { clearHighlight, highlight, pageText } from "#frame/notes/notes.mjs";
import { renders } from "#frame/pages/renderers.mjs";

/* An opened result shows the reader's words in the page. This code reads a
   block's text through shadow roots and asks nothing of any component, so a
   custom component works too. */
const MOST_PER_WORD = 200;
// A short word is only a word when it stands alone, or "the" marks "other".
const SHORT_WORD = 3;
export const isLetter = (char) =>
  char !== undefined && /[\p{L}\p{N}_]/u.test(char);

// The same length as text, so a position in one is a position in the other.
function lowered(text) {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let out = "";
  for (const char of text) {
    const small = char.toLowerCase();
    out += small.length === char.length ? small : char;
  }
  return out;
}

export function findWords(roots, words) {
  const ranges = [];
  for (const root of roots) {
    const { text, map } = pageText(root);
    const lower = lowered(text);
    for (const word of words) {
      let found = 0;
      for (
        let at = lower.indexOf(word);
        at >= 0 && found < MOST_PER_WORD;
        at = lower.indexOf(word, at + word.length)
      ) {
        if (
          word.length <= SHORT_WORD &&
          (isLetter(lower[at - 1]) || isLetter(lower[at + word.length]))
        )
          continue;
        const start = map[at];
        const end = map[at + word.length - 1];
        if (!start || !end) continue;
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset + 1);
        range.word = word;
        ranges.push(range);
        found++;
      }
    }
  }
  return ranges;
}

const inTab = (range) =>
  range.startContainer.parentElement?.closest('[role="tab"]');
const composedParent = (node) =>
  node.parentElement || node.getRootNode().host || null;

// A tab's label naming the words doesn't show them, so its option still opens.
function onScreen(range) {
  if (inTab(range)) return false;
  const element = range.startContainer.parentElement;
  if (!element) return false;
  return element.checkVisibility
    ? element.checkVisibility({ visibilityProperty: true })
    : element.getClientRects().length > 0;
}

/* What hides a range: the closed fold or the hidden element above it, or for
   anything else, the outermost part that doesn't show. */
function hiderOf(range) {
  let hider = null;
  for (
    let at = range.startContainer.parentElement;
    at;
    at = composedParent(at)
  ) {
    if (at.tagName === "DETAILS" && !at.open) return at;
    if (at.hidden) return at;
    if (at.checkVisibility && !at.checkVisibility()) hider = at;
    else if (hider) break;
  }
  return hider;
}

/* A fold opens by itself. Anything else that hides its content hears
   plan:reveal on the hidden element, and a component that hides content
   answers it by showing that element. */
function reveal(hider) {
  for (let at = hider; at; at = composedParent(at)) {
    if (at.tagName === "DETAILS") at.open = true;
    if (at.hidden || at === hider)
      at.dispatchEvent(
        new CustomEvent("plan:reveal", { bubbles: true, composed: true }),
      );
  }
}

/* A block shows the part with the most of the reader's words: the option or
   fold that would show more of them than show now opens, and on a tie nothing
   moves. A hidden element is one of several options, so opening it hides its
   neighbors' words, and a fold hides nothing.
   visibleRange() returns the range to scroll to, or null when no word can show.
   With open set, it opens what hides the best part. A block still drawing may
   yet show the words, so its caller opens nothing until the block has drawn. */
export function visibleRange(ranges, { open = false } = {}) {
  const shown = [];
  const hidden = new Map();
  for (const range of ranges) {
    if (inTab(range)) continue;
    if (onScreen(range)) {
      shown.push(range);
      continue;
    }
    const hider = hiderOf(range);
    if (!hider) continue;
    if (!hidden.has(hider)) hidden.set(hider, { words: new Set(), range });
    hidden.get(hider).words.add(range.word);
  }
  let best = null;
  let most = new Set(shown.map(({ word }) => word)).size;
  for (const [hider, part] of hidden) {
    const stays = hider.hidden
      ? shown.filter(
          ({ startContainer }) =>
            !hider.parentElement?.contains(startContainer),
        )
      : shown;
    const would = new Set([...part.words, ...stays.map(({ word }) => word)]);
    if (would.size > most) {
      most = would.size;
      best = { ...part, hider };
    }
  }
  if (best && open) {
    reveal(best.hider);
    if (onScreen(best.range)) return best.range;
  }
  return ranges.find(onScreen) ?? ranges.find(inTab) ?? null;
}

// Every scrolling box around the words moves them into view, and one that
// already shows them stays where it is, so a line's start isn't cut off.
export function scrollToRange(range) {
  const parent = range.startContainer.parentElement;
  for (let at = parent; at; at = composedParent(at)) {
    const box = range.getBoundingClientRect();
    const style = getComputedStyle(at);
    const page = at === document.documentElement;
    const own = page
      ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
      : at.getBoundingClientRect();
    if (
      (page || /auto|scroll/.test(style.overflowX)) &&
      at.scrollWidth > at.clientWidth + 1 &&
      (box.left < own.left || box.right > own.right)
    )
      at.scrollLeft += box.left + box.width / 2 - (own.left + own.right) / 2;
    if (
      (page || /auto|scroll/.test(style.overflowY)) &&
      at.scrollHeight > at.clientHeight + 1 &&
      (box.top < own.top || box.bottom > own.bottom)
    )
      at.scrollTop += box.top + box.height / 2 - (own.top + own.bottom) / 2;
  }
}

/* An opened result keeps its words highlighted until the reader moves to another
   page. A page can redraw, and a code block or diff rewrites its text after it
   first draws, so markMatch() runs again after each change until clearMatch().
   The hub's text has the words even when the page can't paint them, such as a
   word inside a drawn diagram, and then the nearest part of the block is marked.
   Once the reader scrolls or clicks, the page stays where they put it. */
const REMARK_MS = 40;
const DRAW_LIMIT_MS = 15000;
// A component rewrites its text as it draws, so a block counts as drawn once
// it has been still for a moment.
const QUIET_MS = 160;
const readerInputs = ["wheel", "touchstart", "pointerdown", "keydown"];
let active = null;
let observer = null;
let timer = 0;
let changedAt = 0;

function clearMarked() {
  for (const element of document.querySelectorAll(".search-matched, .matched"))
    element.classList.remove("search-matched", "matched");
}
// Most targets have an id, and a proposal or a control has its own attribute.
export function targetElement(target) {
  if (target.startsWith("proposal-"))
    return document.querySelector(
      `[data-proposal-card="${CSS.escape(target.slice("proposal-".length))}"]`,
    );
  if (target.startsWith("control-")) {
    const id = CSS.escape(target.slice("control-".length));
    return document.querySelector(
      `[data-choice="${id}"], [data-question="${id}"], [data-drawing-question="${id}"]`,
    );
  }
  return document.getElementById(target);
}
function matchRoots({ target }) {
  if (!target)
    return $("review-view").hidden
      ? [$("page-title"), $("page-content")]
      : [$("review-view")];
  // A figure's title and caption sit outside the element that has the id. A sent
  // note's words sit in the card the search window draws above its block.
  const element = targetElement(target);
  return [
    document.getElementById("embed-sent"),
    element?.closest("figure") ?? element,
  ].filter(Boolean);
}
// A long message is clamped until the reader asks for all of it.
function openMessage(root) {
  const clamp = root?.querySelector(".thread-clamp.clamped");
  clamp?.nextElementSibling?.click();
}

export function markMatch() {
  if (!active) return;
  const roots = matchRoots(active);
  if (!roots.length) return;
  if (active.target?.startsWith("thread-")) openMessage(roots[0]);
  const whole = active.phrase ? findWords(roots, [active.phrase]) : [];
  const ranges = whole.length ? whole : findWords(roots, active.words);
  const target = visibleRange(ranges, { open: active.drawn });
  clearMarked();
  const figure = target?.startContainer.parentElement?.closest("svg");
  if (figure)
    (
      target.startContainer.parentElement.closest(".pele-node") ?? figure
    ).classList.add("matched");
  else if (!target && active.drawn)
    roots.at(-1).classList.add("search-matched");
  highlight(
    "plan-search",
    ranges.filter((range) => inTab(range) || onScreen(range)),
  );
  if (target && !active.moved && active.scrolledAt !== target.word) {
    active.scrolledAt = target.word;
    stopLanding();
    scrollToRange(target);
  }
}
function changed() {
  changedAt = performance.now();
  clearTimeout(timer);
  timer = setTimeout(markMatch, REMARK_MS);
}
const moved = () => {
  if (active) active.moved = true;
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
// A closed fold around a root doesn't count as hidden, because marking opens it.
function outsideFolds(root) {
  let outer = root;
  for (
    let fold = root.closest("details:not([open])");
    fold;
    fold = fold.parentElement?.closest("details:not([open])")
  )
    outer = fold;
  return outer;
}
const showing = (match) => {
  const roots = matchRoots(match);
  return (
    roots.length > 0 &&
    roots.every(
      (root) =>
        outsideFolds(root).checkVisibility?.({ visibilityProperty: true }) !==
        false,
    )
  );
};
async function whenDrawn(mine) {
  const limit = performance.now() + DRAW_LIMIT_MS;
  // The frame hides a page until its first draw is done, and until then no word
  // counts as showing. Each pass waits on a timer, so the page keeps running.
  do await wait(REMARK_MS);
  while (
    active === mine &&
    performance.now() < limit &&
    (renders.size || !showing(mine) || performance.now() - changedAt < QUIET_MS)
  );
  if (active !== mine) return;
  mine.drawn = true;
  mine.scrolledAt = null;
  markMatch();
}
export function setMatch(words, target, text = "") {
  clearMatch();
  if (!words?.length) return;
  const phrase = text.trim().toLowerCase();
  active = {
    words,
    target,
    phrase: phrase.includes(" ") ? phrase : null,
    drawn: false,
    moved: false,
    scrolledAt: null,
    landed: null,
  };
  observer = new MutationObserver(changed);
  observer.observe(document.querySelector("main"), {
    subtree: true,
    childList: true,
    characterData: true,
  });
  window.addEventListener("plan:diff", changed);
  document.addEventListener("toggle", changed, true);
  for (const type of readerInputs)
    addEventListener(type, moved, { capture: true, passive: true });
  active.landed = whenDrawn(active);
}
// Resolves once the block has drawn, the words have been marked and the page has
// moved to them, so the search window can show it with nothing left to jump.
export async function whenLanded(limit) {
  const mine = active;
  if (!mine) return;
  await Promise.race([mine.landed, wait(limit - performance.now())]);
  do await wait(REMARK_MS);
  while (
    active === mine &&
    performance.now() < limit &&
    performance.now() - changedAt < QUIET_MS
  );
}
export function clearMatch() {
  if (!active) return;
  active = null;
  clearTimeout(timer);
  observer?.disconnect();
  window.removeEventListener("plan:diff", changed);
  document.removeEventListener("toggle", changed, true);
  for (const type of readerInputs) removeEventListener(type, moved, true);
  clearHighlight("plan-search");
  clearMarked();
}
export const matchWords = (text) =>
  (text || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
export const hasMatch = () => Boolean(active);
