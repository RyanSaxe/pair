import {
  $,
  normalize,
  occurrenceAt,
  occurrenceIndex,
} from "#frame/app/util.mjs";
import { diffSelectionRange } from "#frame/pages/renderers.mjs";

const skippedElements =
  "script, style, pair-thread, textarea[data-diff-input], .katex-mathml";

function appendTextNode(node, state) {
  const data = node.data;
  for (let index = 0; index < data.length; index++) {
    if (/\s/.test(data[index])) {
      state.pendingSpace = state.text.length > 0;
      continue;
    }
    if (state.pendingSpace) {
      state.text += " ";
      state.map.push(null);
      state.pendingSpace = false;
    }
    state.text += data[index];
    state.map.push({ node, offset: index });
  }
}

function shouldWalkChildren(node) {
  if (
    node.nodeType !== Node.ELEMENT_NODE &&
    node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
  ) {
    return false;
  }
  if (node.nodeType === Node.ELEMENT_NODE && node.matches(skippedElements)) {
    return false;
  }
  return true;
}

/* pageText skips pair-thread elements, because a thread card repeats its
   quote and a quote must match the page's own text. The returned text has
   each run of whitespace collapsed to one space, and map contains the node
   and offset of every other character. */
export function pageText(root) {
  const state = { map: [], text: "", pendingSpace: false };
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      appendTextNode(node, state);
      return;
    }
    if (!shouldWalkChildren(node)) return;
    if (node.shadowRoot) walk(node.shadowRoot);
    for (const child of node.childNodes) walk(child);
  }
  walk(root);
  return { text: state.text, map: state.map };
}

export function findText(root, needle, occurrence = 1) {
  const target = normalize(needle);
  if (!target) return null;
  const { text, map } = pageText(root);
  const index = occurrenceIndex(text, target, occurrence);
  if (index < 0) return null;
  const start = map[index];
  const end = map[index + target.length - 1];
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

const quoteBlock = (target) =>
  target && document.getElementById(target)?.closest("#page-content > *");

export function selectedOccurrence(selection, quote, target) {
  const block = quoteBlock(target);
  if (!block || !selection?.rangeCount) return 1;
  // comparePoint needs a Range, and in a diff only the StaticRange from
  // getComposedRanges starts in the shadow root where the selection does.
  const from = diffSelectionRange(selection) || selection.getRangeAt(0);
  const range = document.createRange();
  range.setStart(from.startContainer, from.startOffset);
  const selectionRoot = range.startContainer.getRootNode();
  const { text, map } = pageText(block);
  const start = map.findIndex(
    (point) =>
      point &&
      point.node.getRootNode() === selectionRoot &&
      range.comparePoint(point.node, point.offset) >= 0,
  );
  return occurrenceAt(text, normalize(quote), start);
}

// findQuote searches the note's block first, at the occurrence the reviewer
// selected, so the frame marks a repeated phrase where the reviewer selected
// it. When the block no longer has that many occurrences, findQuote uses the
// first one.
export function findQuote(quote, target, occurrence = 1) {
  const block = quoteBlock(target);
  return (
    (block && (findText(block, quote, occurrence) || findText(block, quote))) ||
    findText($("page-content"), quote)
  );
}

export function clearHighlight(name) {
  /* Safari can leave stale custom-highlight paint when nearby text changes,
     so highlight() deletes a highlight before it sets the highlight again. */
  if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(name);
}

export function highlight(name, ranges) {
  if (typeof CSS !== "undefined" && CSS.highlights) {
    clearHighlight(name);
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
    return;
  }
  for (const range of ranges) {
    if (range.startContainer !== range.endContainer) continue;
    const mark = document.createElement("mark");
    mark.className = "note-mark";
    try {
      range.surroundContents(mark);
    } catch {
      /* A range that surroundContents cannot wrap stays unmarked, and
         countNotes still counts its note. */
    }
  }
}
