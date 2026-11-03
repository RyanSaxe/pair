import { state } from "#frame/app/store.mjs";
import {
  $,
  normalize,
  occurrenceAt,
  occurrenceIndex,
  plural,
} from "#frame/app/util.mjs";
import {
  editable,
  embedded,
  feedbackEditable,
  noteEditable,
  online,
  page,
  plan,
  showingWaiting,
  topicTitle,
} from "#frame/app/view.mjs";
import {
  besideControl,
  besideElement,
  besideText,
  openDrawer,
  pressedControl,
} from "#frame/app/drawer.mjs";
import { commentTarget, placeBar } from "#frame/notes/blocks.mjs";
import { rebuildKnown } from "#frame/notes/known.mjs";
import {
  drawNoteImages,
  fitNoteText,
  imageError,
  setNoteImages,
  settleNoteImages,
  yieldNote,
} from "#frame/notes/note-dialog.mjs";
import { show } from "#frame/pages/pages.mjs";
import { diagramBoxes } from "#frame/pages/diagram.mjs";
import { cardsEditable } from "#frame/pages/work.mjs";
import { diffSelectionRange, isDiffNode } from "#frame/pages/renderers.mjs";

export let editing = null;
export let noteContext = null;
export let noteDraftKey = "";
let opener = null;

/* pageText skips pair-thread elements, because a thread card repeats its
   quote and a quote must match the page's own text. The returned text has
   each run of whitespace collapsed to one space, and map contains the node
   and offset of every other character. */
export function pageText(root) {
  const map = [];
  let text = "",
    pendingSpace = false;
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = node.data;
      for (let index = 0; index < data.length; index++) {
        if (/\s/.test(data[index])) {
          pendingSpace = text.length > 0;
          continue;
        }
        if (pendingSpace) {
          text += " ";
          map.push(null);
          pendingSpace = false;
        }
        text += data[index];
        map.push({ node, offset: index });
      }
      return;
    }
    if (
      node.nodeType !== Node.ELEMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    )
      return;
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      node.matches(
        "script, style, pair-thread, textarea[data-diff-input], .katex-mathml",
      )
    )
      return;
    if (node.shadowRoot) walk(node.shadowRoot);
    for (const child of node.childNodes) walk(child);
  }
  walk(root);
  return { text, map };
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
const richContent =
  "[data-language], [data-diagram], [data-math], [data-chart], [data-prototype]";
let noteRanges = [];
// A CSS highlight cannot mark text in an SVG, so markNotes marks a noted
// diagram box with the noted class instead.
let noteBoxes = [];
export function markNotes() {
  // The words a new note is on stay marked while its dialog is open.
  const writing =
    $("note-dialog").open && !editing && noteContext?.topic === page.id
      ? [noteContext]
      : [];
  const notes = [
    ...state.notes.filter((note) => note.topic === page.id),
    ...writing,
  ];
  noteRanges = [];
  noteBoxes = [];
  for (const box of $("page-content").querySelectorAll(".pele-node.noted"))
    box.classList.remove("noted");
  for (const note of notes) {
    if (!note.quote) continue;
    if (note.diagramNode) {
      for (const box of diagramBoxes(note.target, note.diagramNode)) {
        box.classList.add("noted");
        noteBoxes.push({ note, box });
      }
      continue;
    }
    const range = findQuote(note.quote, note.target, note.occurrence);
    if (
      !range ||
      (range.startContainer.parentElement?.closest(richContent) &&
        !isDiffNode(range.startContainer))
    )
      continue;
    noteRanges.push({ note, range });
  }
  highlight(
    "plan-note",
    noteRanges.map((item) => item.range),
  );
  placeNoteBars();
  countNotes();
}
// markNotes never runs for Agreed or for a pending page, so show() calls
// countNotes for every page.
export function countNotes() {
  const count = showingWaiting()
    ? 0
    : state.notes.filter((note) => note.topic === page.id).length;
  $("note-count").hidden = !count;
  $("note-count").textContent = count
    ? `${plural(count, "note")} on this page`
    : "";
}
// A CSS highlight has no element to hover, so notesAt hit-tests the pointer
// against the note ranges. showTip shows every overlapping note in one tip.
function notesAt(x, y) {
  let node, offset;
  if (document.caretPositionFromPoint) {
    // caretPositionFromPoint returns a position inside a diff's shadow root
    // only when the call passes that root.
    const shadowRoots = noteRanges
      .map(({ range }) => range.startContainer.getRootNode())
      .filter((root) => root instanceof ShadowRoot);
    const position = document.caretPositionFromPoint(x, y, { shadowRoots });
    if (!position) return [];
    node = position.offsetNode;
    offset = position.offset;
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return [];
    node = range.startContainer;
    offset = range.startOffset;
  } else return [];
  const hit = document.elementFromPoint(x, y);
  return [
    ...noteRanges.filter(({ range }) => {
      try {
        return range.isPointInRange(node, offset);
      } catch {
        return false;
      }
    }),
    ...noteBoxes.filter(({ box }) => box.contains(hit)),
  ].map((item) => item.note);
}
let tipNotes = "";
function showTip(event) {
  // The note being written has no text to show yet.
  const notes = (
    noteRanges.length || noteBoxes.length
      ? notesAt(event.clientX, event.clientY)
      : []
  ).filter((note) => note.text);
  const key = notes.map((note) => note.id).join();
  const tip = $("note-tip");
  if (!notes.length) {
    tip.hidden = true;
    tipNotes = "";
    $("page-content").style.cursor = "";
    return;
  }
  if (key !== tipNotes) {
    tip.replaceChildren(
      ...notes.map((note) => {
        const line = document.createElement("p");
        line.textContent = note.text;
        return line;
      }),
    );
    tipNotes = key;
  }
  tip.hidden = false;
  $("page-content").style.cursor = "pointer";
  const width = tip.offsetWidth;
  tip.style.left = `${Math.min(event.pageX + 14, innerWidth - width - 12)}px`;
  tip.style.top = `${event.pageY + 18}px`;
}
export function installNotes() {
  rebuildKnown();
  // A diff and a diagram render their content again after the page renders,
  // so markNotes runs again on their events.
  for (const name of ["plan:diff", "plan:diagram"])
    window.addEventListener(name, () => {
      if (!$("reading").hidden && !page.pending && page.id !== "agreed")
        markNotes();
    });
  $("page-content").addEventListener("mousemove", showTip);
  $("page-content").addEventListener("mouseleave", () => {
    $("note-tip").hidden = true;
    tipNotes = "";
  });
  $("page-content").addEventListener("click", (event) => {
    if (
      !editable ||
      event.target.closest("button, a, input, textarea, summary")
    )
      return;
    const notes = notesAt(event.clientX, event.clientY);
    if (notes.length === 1) openNote(notes[0]);
    else if (notes.length > 1) show("feedback");
    // This keeps a click on a noted box from also opening the enlarged
    // diagram.
    if (notes.some((note) => note.diagramNode))
      event.stopImmediatePropagation();
  });
  /* markNotes waits a frame, so it runs after a save has redrawn the page, and
     a note the reviewer backed out of loses its mark. */
  $("note-dialog").addEventListener("close", () => {
    commentTarget();
    requestAnimationFrame(() => {
      if (
        !$("note-dialog").open &&
        !$("reading").hidden &&
        page.id !== "agreed"
      )
        markNotes();
    });
  });
  /* The browser returns focus to the control that opened the dialog, but
     not when the frame has redrawn that control. A save redraws the page,
     which focuses its heading, or redraws Review's list. This handler then
     focuses the redrawn element with the control's nearest ID, which is the
     block, card or Review item that the note is on. When another drawer took
     the note's place, focus stays in that drawer. */
  $("note-dialog").addEventListener("close", () => {
    if (document.querySelector("dialog[data-drawer][open]")) return;
    const shown = (element) =>
      element?.isConnected && element.checkVisibility();
    if (shown(opener)) {
      opener.focus({ preventScroll: true });
      return;
    }
    const home = opener?.closest("[id]");
    const block = home && $(home.id);
    if (!shown(block)) return;
    if (!block.hasAttribute("tabindex")) block.tabIndex = -1;
    block.focus({ preventScroll: true });
  });
  /* A tab switch, a loaded image or a new window width moves the blocks
     under the bars, and each of those changes the size of page-content. */
  new ResizeObserver(placeMarks).observe($("page-content"));
}

export function openNote({
  topic,
  anchor,
  quote = "",
  id = null,
  agreementId = null,
  target = null,
  occurrence = 1,
  diffLine = null,
  diagramNode = null,
  proposal = null,
}) {
  // After the round's feedback is sent, openNote opens only a new note,
  // which can only start a thread. A note on a card can start a thread
  // wherever the card's Start button works.
  const feedback = feedbackEditable();
  const threads = proposal ? cardsEditable() : noteEditable();
  if (!feedback && (id || !threads)) return false;
  const context = {
    topic,
    anchor,
    quote,
    ...(agreementId ? { agreementId } : {}),
    ...(target ? { target } : {}),
    ...(occurrence > 1 ? { occurrence } : {}),
    ...(diffLine ? { diffLine } : {}),
    ...(diagramNode ? { diagramNode } : {}),
    ...(proposal ? { proposal } : {}),
  };
  // The key includes everything that places the note, so two selections of
  // the same words keep separate drafts.
  const key = JSON.stringify([id, context]);
  if ($("note-dialog").open && key === noteDraftKey) {
    $("note-text").focus();
    return true;
  }
  if (!yieldNote()) return false;
  noteContext = context;
  editing = id;
  noteDraftKey = key;
  const pageTitle = topicTitle(topic) || anchor;
  const place =
    anchor && anchor !== pageTitle ? `${pageTitle} › ${anchor}` : pageTitle;
  // In the search window, the comment may go to another session.
  $("note-anchor").textContent = embedded
    ? `${plan.title} › Round ${plan.round} › ${place}`
    : place;
  $("note-quote").textContent = quote;
  $("note-quote").hidden = !quote;
  $("note-text").value =
    state.noteDrafts?.[noteDraftKey] ??
    (id ? state.notes.find((note) => note.id === id).text : "");
  settleNoteImages();
  setNoteImages(
    id
      ? [...(state.notes.find((note) => note.id === id)?.attachments || [])]
      : [],
  );
  drawNoteImages();
  imageError("");
  $("note-title").textContent = id ? "Edit note" : "Add note";
  $("note-save-label").textContent = id ? "Save changes" : "Add to draft";
  $("note-thread").hidden = Boolean(id) || !online || !threads;
  $("note-save").hidden = !feedback;
  // openAgentMessage changes these parts of the dialog, so openNote resets
  // them on every open.
  $("note-label").textContent = "Note";
  $("note-anchor").hidden = false;
  $("note-thread").classList.remove("primary");
  if (!$("note-dialog").open) opener = document.activeElement;
  // The box takes its height before the drawer is placed.
  fitNoteText();
  openDrawer($("note-dialog"), noteSpot(noteContext));
  fitNoteText();
  $("note-text").focus();
  if (!$("reading").hidden && !page.pending && page.id !== "agreed")
    markNotes();
  commentTarget();
  return true;
}
/* A note opens beside its words, or beside its block or card, or else beside
   the control the reviewer pressed, such as Edit on Review or the comment
   button. */
function noteSpot(note) {
  const range =
    note.quote &&
    note.topic === page.id &&
    !$("reading").hidden &&
    findQuote(note.quote, note.target, note.occurrence);
  if (range && range.getClientRects().length) return besideText(range);
  const block =
    (note.target && document.getElementById(note.target)) ||
    (note.proposal &&
      document.querySelector(
        `[data-proposal-card="${CSS.escape(note.proposal)}"]`,
      ));
  if (block?.checkVisibility()) return besideElement(block);
  return besideControl(pressedControl() || $("comment-here"));
}
export const progressThread = {
  topic: "agreed",
  anchor: "Progress",
  target: "agent-activity",
};
/* The progress card's button calls openAgentMessage to start a thread about
   the work in progress. The dialog shows only Start a thread, because the
   frame sends this message to the agent now and not with the round's
   feedback. */
export function openAgentMessage() {
  if (!openNote(progressThread)) return;
  $("note-title").textContent = "Message the agent";
  $("note-label").textContent = "Message";
  $("note-anchor").hidden = true;
  $("note-save").hidden = true;
  $("note-thread").classList.add("primary");
  commentTarget();
}
/* A note that quotes nothing has no highlight, so placeNoteBars marks its
   block with a bar in the same padding as the chosen block's bar. */
function placeNoteBars() {
  const host = $("note-bars");
  host.replaceChildren();
  if ($("reading").hidden) return;
  const blocks = new Set();
  for (const note of state.notes) {
    if (note.topic !== page.id || note.quote || !note.target) continue;
    const block = document
      .getElementById(note.target)
      ?.closest("#page-content > *");
    if (block) blocks.add(block);
  }
  const hostTop = $("reading").getBoundingClientRect().top;
  for (const block of blocks) {
    const box = block.getBoundingClientRect();
    const bar = document.createElement("div");
    bar.className = "note-bar";
    bar.style.top = `${Math.round(box.top - hostTop)}px`;
    bar.style.height = `${Math.round(box.height)}px`;
    host.append(bar);
  }
}
export function placeMarks() {
  placeBar();
  placeNoteBars();
}
