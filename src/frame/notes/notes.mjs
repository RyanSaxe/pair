import { state } from "#frame/app/store.mjs";
import {
  $,
  controlKey,
  normalize,
  occurrenceAt,
  occurrenceIndex,
  plural,
} from "#frame/app/util.mjs";
import {
  agreedTask,
  agreements,
  editable,
  feedbackEditable,
  noteEditable,
  online,
  page,
  pages,
  showingWaiting,
  topicTitle,
} from "#frame/app/view.mjs";
import { placeBar } from "#frame/notes/blocks.mjs";
import { choiceTargets } from "#frame/notes/controls.mjs";
import {
  drawNoteImages,
  fitNoteText,
  imageError,
  setNoteImages,
  settleNoteImages,
} from "#frame/notes/note-dialog.mjs";
import { show } from "#frame/pages/pages.mjs";
import { diagramBoxes } from "#frame/pages/diagram.mjs";
import { cardsEditable } from "#frame/pages/work.mjs";
import { isDiffNode } from "#frame/pages/renderers.mjs";

export const known = {
  choices: new Set(),
  lists: new Set(),
  questions: new Set(),
  text: new Map(),
};
export function indexPage(topic) {
  const template = document.createElement("template");
  template.innerHTML = topic.html;
  choiceTargets(template.content, topic.id);
  for (const group of template.content.querySelectorAll("[data-choice]"))
    known.choices.add(controlKey(topic.id, group.dataset.choice));
  for (const group of template.content.querySelectorAll("[data-multiselect]"))
    known.lists.add(controlKey(topic.id, group.dataset.multiselect));
  for (const group of template.content.querySelectorAll("[data-question]"))
    known.questions.add(controlKey(topic.id, group.dataset.question));
  for (const group of template.content.querySelectorAll(
    "[data-drawing-question]",
  ))
    known.questions.add(controlKey(topic.id, group.dataset.drawingQuestion));
  const text = [template.content.textContent];
  for (const source of template.content.querySelectorAll(
    "textarea[data-diff-input]",
  )) {
    try {
      const input = JSON.parse(source.value);
      if (typeof input.before === "string") text.push(input.before);
      if (typeof input.after === "string") text.push(input.after);
    } catch {
      // The page builder reports malformed diff input before the page runs.
    }
  }
  known.text.set(topic.id, normalize(text.join("\n")));
}
export function rebuildKnown() {
  known.choices.clear();
  known.lists.clear();
  known.questions.clear();
  known.text.clear();
  for (const topic of pages.filter(
    (item) => item.id !== "agreed" && !item.pending,
  ))
    indexPage(topic);
}
export function stale(kind, key, item) {
  if (kind === "note") {
    // Review's overall comment and Work are in every round.
    if (item.topic === "overall" || item.topic === "work") return false;
    if (item.topic === "agreed")
      return Boolean(
        item.agreementId &&
        !(item.agreementId === "task" && agreedTask) &&
        !agreements.some((entry) => entry.id === item.agreementId),
      );
    if (!known.text.has(item.topic))
      return !pages.some((entry) => entry.id === item.topic && entry.pending);
    return (
      Boolean(item.quote) &&
      !known.text.get(item.topic).includes(normalize(item.quote))
    );
  }
  if (pages.some((entry) => entry.id === item.topic && entry.pending))
    return false;
  if (kind === "answer") return !known.questions.has(key);
  if (kind === "list") return !known.lists.has(key);
  return !known.choices.has(key);
}
export let editing = null;
export let noteContext = null;
export let noteDraftKey = "";
let opener = null;

/* Notes on the text. A quote is the page's own text, so a thread card that
   repeats it is never where it is found. The text has each run of whitespace
   as one space, and map has the node and offset of every other character. */
function pageText(root) {
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
      node.matches("script, style, pair-thread, textarea[data-diff-input]")
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
// Which appearance of the selected words in the note's block the selection
// starts at.
export function selectedOccurrence(selection, quote, target) {
  const block = quoteBlock(target);
  if (!block || !selection?.rangeCount) return 1;
  const range = selection.getRangeAt(0);
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
// Selected words are looked for first in the block the note names, at the
// appearance the reviewer selected, so a phrase the page repeats is marked
// where it was selected. A note with no occurrence is on the first, and so
// is one whose block no longer has that many.
export function findQuote(quote, target, occurrence = 1) {
  const block = quoteBlock(target);
  return (
    (block && (findText(block, quote, occurrence) || findText(block, quote))) ||
    findText($("page-content"), quote)
  );
}
export function clearHighlight(name) {
  /* Safari can keep custom-highlight paint stale when nearby text changes. */
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
      /* Partial selections stay unmarked; the count line still reports them. */
    }
  }
}
const richContent =
  "[data-language], [data-diagram], [data-math], [data-chart], [data-prototype]";
let noteRanges = [];
// A note on one box of a diagram marks the box, which a highlight cannot
// reach in an SVG.
let noteBoxes = [];
export function markNotes() {
  const notes = state.notes.filter((note) => note.topic === page.id);
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
// Agreed and a page still being prepared never reach markNotes, so show sets
// the count for every page the reader opens.
export function countNotes() {
  const count = showingWaiting()
    ? 0
    : state.notes.filter((note) => note.topic === page.id).length;
  $("note-count").hidden = !count;
  $("note-count").textContent = count
    ? `${plural(count, "note")} on this page`
    : "";
}
// Highlights have no element to hover, so the pointer is hit-tested against
// the note ranges; overlapping notes all show in one tip.
function notesAt(x, y) {
  let node, offset;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
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
  const notes =
    noteRanges.length || noteBoxes.length
      ? notesAt(event.clientX, event.clientY)
      : [];
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
  // A diff and a diagram draw their content again after the page renders.
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
    // A click on a noted box opens its note instead of the enlarged view.
    if (notes.some((note) => note.diagramNode))
      event.stopImmediatePropagation();
  });
  /* Rebuild the range after a close has finished any page replacement. */
  $("note-dialog").addEventListener("close", () => {
    requestAnimationFrame(() => {
      if (
        !$("note-dialog").open &&
        !$("reading").hidden &&
        page.id !== "agreed"
      )
        markNotes();
    });
  });
  /* Closing puts focus back on the control that opened the note. The
     browser does that itself, but not to a control that was redrawn: a save
     redraws the page, which focuses its heading, or Review's list. Focus
     then goes to the redrawn element that held the control, found by its
     ID: the block, card or Review item the note is on. */
  $("note-dialog").addEventListener("close", () => {
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
  /* A tab switch, an image, or a new window width moves the block under the
     bar, and each of those changes the page's own size. */
  new ResizeObserver(placeMarks).observe($("page-content"));
}

/* A note's dialog, for a new note on what it names or, with id, to edit
   that note. A note on a proposal names the card, and its Start a thread
   starts the card's own thread. */
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
  // After the round's feedback is sent, only a new note opens, and it can
  // only start a thread: on the round, or on a card wherever its Start
  // works.
  const feedback = feedbackEditable();
  const threads = proposal ? cardsEditable() : noteEditable();
  if (!feedback && (id || !threads)) return;
  clearHighlight("plan-note");
  noteContext = {
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
  editing = id;
  noteDraftKey = JSON.stringify([
    topic,
    anchor,
    quote,
    id,
    agreementId,
    ...(proposal ? [proposal] : []),
  ]);
  const pageTitle = topicTitle(topic) || anchor;
  $("note-anchor").textContent =
    anchor && anchor !== pageTitle ? `${pageTitle} › ${anchor}` : pageTitle;
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
  $("note-save-label").textContent = id ? "Save changes" : "Add to feedback";
  // A new note can start a thread, when a hub can take it.
  $("note-thread").hidden = Boolean(id) || !online || !threads;
  $("note-save").hidden = !feedback;
  // Every note opens the dialog in its usual form, whatever the last
  // opening changed.
  $("note-label").textContent = "Feedback";
  $("note-anchor").hidden = false;
  $("note-thread").classList.remove("primary");
  opener = document.activeElement;
  $("note-dialog").showModal();
  fitNoteText();
  $("note-text").focus();
}
/* The progress card's button starts a thread about the work in progress.
   The dialog shows only Start a thread, because the message is for the
   agent now and does not go into the round's feedback. */
export function openAgentMessage() {
  openNote({ topic: "agreed", anchor: "Progress", target: "agent-activity" });
  if (!$("note-dialog").open) return;
  $("note-title").textContent = "Message the agent";
  $("note-label").textContent = "Message";
  $("note-anchor").hidden = true;
  $("note-save").hidden = true;
  $("note-thread").classList.add("primary");
}
/* A note that quotes nothing leaves no highlight to find it by, so the block
   it belongs to keeps a quiet bar in the same padding the chosen one uses.
   Accent means chosen now; muted means this block has notes. */
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
