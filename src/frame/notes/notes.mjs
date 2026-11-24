import { openDrawer } from "#frame/app/drawer.mjs";
import { callHook } from "#frame/app/hooks.mjs";
import {
  editing,
  noteContext,
  noteDraftKey,
  progressThread,
  setEditing,
  setNoteContext,
  setNoteDraftKey,
} from "#frame/app/state.mjs";
import { state } from "#frame/app/store.mjs";
import { $, plural } from "#frame/app/util.mjs";
import {
  editable,
  embedded,
  online,
  page,
  plan,
  showingWaiting,
  topicTitle,
} from "#frame/app/view.mjs";
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
import { findQuote, highlight } from "#frame/notes/quote.mjs";
import { diagramBoxes } from "#frame/pages/diagram.mjs";
import { isDiffNode } from "#frame/pages/renderers.mjs";
import { cardsEditable } from "#frame/pages/work-model.mjs";
import { feedbackEditable, noteEditable } from "#frame/review/send-state.mjs";
import { clearOwnRound } from "#frame/sync/center-state.mjs";

let opener = null;

const richContent =
  "[data-language], [data-diagram], [data-math], [data-chart], [data-prototype]";
let noteRanges = [];
// A CSS highlight cannot mark text in an SVG, so markNotes marks a noted
// diagram box with the noted class instead.
let noteBoxes = [];

function markNoteTarget(note) {
  if (!note.quote) return;
  if (note.diagramNode) {
    for (const box of diagramBoxes(note.target, note.diagramNode)) {
      box.classList.add("noted");
      noteBoxes.push({ note, box });
    }
    return;
  }
  const range = findQuote(note.quote, note.target, note.occurrence);
  if (
    !range ||
    (range.startContainer.parentElement?.closest(richContent) &&
      !isDiffNode(range.startContainer))
  ) {
    return;
  }
  noteRanges.push({ note, range });
}

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
  for (const box of $("page-content").querySelectorAll(".pele-node.noted")) {
    box.classList.remove("noted");
  }
  for (const note of notes) markNoteTarget(note);
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

const isShown = (element) => element?.isConnected && element.checkVisibility();
export function installNotes() {
  rebuildKnown();
  // A diff and a diagram render their content again after the page renders,
  // so markNotes runs again on their events.
  for (const name of ["plan:diff", "plan:diagram"]) {
    window.addEventListener(name, () => {
      if (!$("reading").hidden && !page.pending && page.id !== "agreed") {
        markNotes();
      }
    });
  }
  $("page-content").addEventListener("mousemove", showTip);
  $("page-content").addEventListener("mouseleave", () => {
    $("note-tip").hidden = true;
    tipNotes = "";
  });
  $("page-content").addEventListener("click", (event) => {
    if (
      !editable ||
      event.target.closest("button, a, input, textarea, summary")
    ) {
      return;
    }
    const notes = notesAt(event.clientX, event.clientY);
    if (notes.length === 1) openNote(notes[0]);
    else if (notes.length > 1) callHook("show", "feedback");
    // This keeps a click on a noted box from also opening the enlarged
    // diagram.
    if (notes.some((note) => note.diagramNode)) {
      event.stopImmediatePropagation();
    }
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
      ) {
        markNotes();
      }
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
    if (isShown(opener)) {
      opener.focus({ preventScroll: true });
      return;
    }
    const home = opener?.closest("[id]");
    const block = home && $(home.id);
    if (!isShown(block)) return;
    if (!block.hasAttribute("tabindex")) block.tabIndex = -1;
    block.focus({ preventScroll: true });
  });
  /* A tab switch, a loaded image or a new window width moves the blocks
     under the bars, and each of those changes the size of page-content. */
  new ResizeObserver(placeMarks).observe($("page-content"));
}

const optionalNoteFields = [
  "agreementId",
  "target",
  "diffLine",
  "diagramNode",
  "proposal",
];

function buildNoteContext(options) {
  const context = {
    topic: options.topic,
    anchor: options.anchor,
    quote: options.quote ?? "",
  };
  for (const key of optionalNoteFields) {
    if (options[key]) context[key] = options[key];
  }
  if ((options.occurrence ?? 1) > 1) context.occurrence = options.occurrence;
  return context;
}

function noteAnchorText(topic, anchor) {
  const pageTitle = topicTitle(topic) || anchor;
  const place =
    anchor && anchor !== pageTitle ? `${pageTitle} › ${anchor}` : pageTitle;
  // In the search window, the comment may go to another session.
  return embedded ? `${plan.title} › Round ${plan.round} › ${place}` : place;
}

function setNoteDialogControls(id, { feedback, threads }) {
  $("note-title").textContent = id ? "Edit note" : "Add note";
  $("note-save-label").textContent = id ? "Save changes" : "Add to draft";
  $("note-thread").hidden = Boolean(id) || !online || !threads;
  $("note-save").hidden = !feedback;
  // openAgentMessage changes these parts of the dialog, so openNote resets
  // them on every open.
  $("note-label").textContent = "Note";
  $("note-anchor").hidden = false;
  $("note-thread").classList.remove("primary");
}

function populateNoteDialog(context, id, permissions) {
  const existing = id ? state.notes.find((note) => note.id === id) : null;
  $("note-anchor").textContent = noteAnchorText(context.topic, context.anchor);
  $("note-quote").textContent = context.quote;
  $("note-quote").hidden = !context.quote;
  $("note-text").value =
    state.noteDrafts?.[noteDraftKey] ?? (existing ? existing.text : "");
  settleNoteImages();
  setNoteImages(existing ? [...(existing.attachments || [])] : []);
  drawNoteImages();
  imageError("");
  setNoteDialogControls(id, permissions);
}

function canOpenNotePageMark() {
  return !$("reading").hidden && !page.pending && page.id !== "agreed";
}

function notePermissions(options) {
  // After the round's feedback is sent, openNote opens only a new note,
  // which can only start a thread. A note on a card can start a thread
  // wherever the card's Start button works.
  const id = options.id ?? null;
  const feedback = feedbackEditable();
  const threads = options.proposal ? cardsEditable() : noteEditable();
  if (!feedback && (id || !threads)) return null;
  return { id, feedback, threads };
}

export function openNote(options) {
  clearOwnRound();
  const permissions = notePermissions(options);
  if (!permissions) return false;
  const { id } = permissions;
  const context = buildNoteContext(options);
  // The key includes everything that places the note, so two selections of
  // the same words keep separate drafts.
  const key = JSON.stringify([id, context]);
  if ($("note-dialog").open && key === noteDraftKey) {
    $("note-text").focus();
    return true;
  }
  if (!yieldNote()) return false;
  setNoteContext(context);
  setEditing(id);
  setNoteDraftKey(key);
  populateNoteDialog(context, id, permissions);
  if (!$("note-dialog").open) opener = document.activeElement;
  // The box takes its height before the drawer is placed.
  fitNoteText();
  openDrawer($("note-dialog"), {
    ...noteAbout(noteContext),
    field: $("note-text"),
  });
  fitNoteText();
  if (canOpenNotePageMark()) markNotes();
  commentTarget();
  return true;
}

function selectedWordsRange(note) {
  const selection = getSelection();
  if (
    !note.quote ||
    !selection.rangeCount ||
    selection.isCollapsed ||
    !$("page-content").contains(selection.anchorNode)
  ) {
    return null;
  }
  return selection.getRangeAt(0).cloneRange();
}

function quotedWordsRange(note) {
  if (!note.quote || note.topic !== page.id || $("reading").hidden) {
    return null;
  }
  const quoted = findQuote(note.quote, note.target, note.occurrence);
  return quoted && quoted.getClientRects().length ? quoted : null;
}

/* What a note is about, for openDrawer: the words still selected or the words
   it quotes, and its block or card. A note on nothing else, such as one from
   the c key, opens where the comment button is. */
function noteAbout(note) {
  const words = selectedWordsRange(note) || quotedWordsRange(note);
  const block =
    (note.target && document.getElementById(note.target)) ||
    (note.proposal &&
      document.querySelector(
        `[data-proposal-card="${CSS.escape(note.proposal)}"]`,
      ));
  return { words, block, home: $("comment-here") };
}

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
