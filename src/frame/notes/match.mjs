import { pageText } from "#frame/notes/notes.mjs";

/* The modal's preview and an opened result both show a reader's words in a
   drawn block. This code reads the block's text through shadow roots, so it
   needs no knowledge of any component. */
const MOST_PER_WORD = 200;

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
        at = lower.indexOf(word, at + word.length), found++
      ) {
        const start = map[at];
        const end = map[at + word.length - 1];
        if (!start || !end) continue;
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset + 1);
        ranges.push(range);
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

/* A fold opens by itself. Anything else that hides its content hears
   plan:reveal on the hidden element, and a component that hides content
   answers it by showing that element. */
function reveal(range) {
  for (
    let at = range.startContainer.parentElement;
    at;
    at = composedParent(at)
  ) {
    if (at.tagName === "DETAILS") at.open = true;
    if (at.hidden)
      at.dispatchEvent(
        new CustomEvent("plan:reveal", { bubbles: true, composed: true }),
      );
  }
}

/* visibleRange() returns the range to scroll to, or null when no word is on
   screen. With open set, it first opens what hides the words. A block still
   drawing may yet show them, so its caller opens nothing until the block has
   drawn. */
export function visibleRange(ranges, { open = false } = {}) {
  let target = ranges.find(onScreen);
  if (!target && open && ranges.length) {
    reveal(ranges.find((range) => !inTab(range)) ?? ranges[0]);
    target = ranges.find(onScreen) ?? ranges.find(inTab);
  }
  return target ?? null;
}

// A long line scrolls sideways inside its code block or diff, so the words are
// centered there too.
export function scrollToRange(range) {
  const parent = range.startContainer.parentElement;
  parent?.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "instant",
  });
  const box = range.getBoundingClientRect();
  for (let at = parent; at; at = composedParent(at)) {
    if (
      at.scrollWidth <= at.clientWidth + 1 ||
      !/auto|scroll/.test(getComputedStyle(at).overflowX)
    )
      continue;
    const own = at.getBoundingClientRect();
    if (box.left < own.left || box.right > own.right)
      at.scrollLeft += box.left + box.width / 2 - own.left - own.width / 2;
    break;
  }
}
