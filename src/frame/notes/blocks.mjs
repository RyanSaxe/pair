import { scroller } from "#frame/app/places.mjs";
import { persist, state } from "#frame/app/store.mjs";
import { $, normalize } from "#frame/app/util.mjs";
import { editable, noteEditable, page } from "#frame/app/view.mjs";
import {
  noteDraftKey,
  openNote,
  selectedOccurrence,
} from "#frame/notes/notes.mjs";

let selected = "";
let selectedTarget = null;
// Every direct child of the page content is a block and gets a comment
// control, whatever it is; paragraphs, headings and lists are the exception,
// since their text is what selection comments are for.
export const blockSkip = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "HR",
  "BR",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  // A thread's card sits between blocks and is not one.
  "PAIR-THREAD",
]);
// The nearest heading before the block, which is how a reader would say
// where it is. A page cannot repeat its own title in one, the build refuses
// that, so this can no longer echo the page name back.
function headingAbove(block) {
  let previous = block.previousElementSibling;
  while (previous && !/^H[1-6]$/.test(previous.tagName))
    previous = previous.previousElementSibling;
  return previous;
}
const sentence = (kind) =>
  kind.replace(/^(this|these) /, "").replace(/^./, (c) => c.toUpperCase());
function blockHeading(block) {
  const name = blockName(block);
  /* Two blocks under one heading, or two of a kind with no heading at all,
     take the same name, and Feedback lists them with nothing else to tell
     them apart. Number them only when they collide. */
  const peers = [...block.parentElement.children].filter(
    (other) => !blockSkip.has(other.tagName) && blockName(other) === name,
  );
  return peers.length < 2 ? name : `${name} ${peers.indexOf(block) + 1}`;
}
function blockName(block) {
  const read = (node) => normalize(node?.textContent);
  /* What the block gives for a name, in the order a reader would pick: its
     own heading, the title an author set, the title the frame drew for a
     figure, then the caption. Never the block's text, which is a table's
     cells, a renderer's injected stylesheet and its buttons. A block that
     gives no name returns none, and the note is filed under its page. */
  const named = "[data-title], [data-caption], [data-file]";
  const titled = block.matches(named) ? block : block.querySelector(named);
  /* A heading inside a closed details is a section of the block's source,
     not a name for it: the diff's own "Before" and "Git patch" live there. */
  const heading = [...block.querySelectorAll("h1, h2, h3, h4, h5, h6")].find(
    (node) => !node.closest("details"),
  );
  const name =
    read(heading) ||
    normalize(titled?.dataset.title) ||
    normalize(titled?.dataset.file) ||
    read(block.querySelector(".figure-head b")) ||
    normalize(titled?.dataset.caption) ||
    read(block.querySelector(".figure-caption")) ||
    /* Feedback lists every note together and the agent reads them as text,
       and in neither place is the block on screen to look at. A block that
       names nothing takes the heading it sits under, then what it is. */
    read(headingAbove(block)) ||
    sentence(blockKind(block));
  return name.length > 60 ? name.slice(0, 57) + "…" : name;
}

/* A note on a block carries the block's ID so Feedback can jump back to it.
   A paragraph, heading or list gets one too, so a note or thread on words
   selected in it records that block, even when an earlier block has the
   same words. */
export function blockTargets(root, topic) {
  [...root.children].forEach((block, index) => {
    block.id ||= `block-${topic}-${index}`;
  });
}
export function pageBlocks() {
  return [...$("page-content").children];
}
/* The bar marks the chosen block. placeMarks() calls this whenever the
   page's layout changes, so it also places the Comment button, which moves
   with the selection and the chosen block. */
export let chosen = null;
export function placeBar() {
  const bar = $("chosen-bar");
  bar.hidden = !chosen;
  placeButton();
  if (!chosen) return;
  const host = $("reading").getBoundingClientRect();
  const box = chosen.getBoundingClientRect();
  bar.style.top = `${Math.round(box.top - host.top)}px`;
  bar.style.height = `${Math.round(box.height)}px`;
}
export function chooseBlock(block) {
  chosen = block && block !== chosen ? block : null;
  commentTarget();
}
/* The block's button names what kind of thing it will comment on; the note
   itself still records the block's own heading. */
function blockKind(block) {
  const has = (selector) =>
    block.matches(selector) || block.querySelector(selector) !== null;
  /* A component names itself, so the frame never learns a component's class.
     Everything below is an attribute any component may use. */
  const declared = block.closest("[data-kind]")?.dataset.kind;
  if (declared) return `this ${declared}`;
  /* What the block is comes before what it holds, so a decision whose options
     are diagrams is still a decision. A figure is last because every diagram
     and chart contains one. */
  if (has("[data-choice]")) return "this decision";
  if (has("[data-question]")) return "this question";
  if (has("[data-multiselect]")) return "this checklist";
  if (has("table")) return "this table";
  if (has("[data-language], .shiki")) return "this code";
  if (has("[data-diagram]")) return "this diagram";
  if (has("[data-chart]")) return "this chart";
  if (has("[data-math]")) return "this formula";
  if (has("[data-prototype]")) return "this prototype";
  if (has("figure, .figure, svg, img")) return "this figure";
  return "this block";
}
/* The c key comments on the selection, then the chosen block, then the
   page. The title's link always comments on the page, and the button beside
   the selection or the chosen block comments on that. */
const target = () =>
  selected.length > 3 ? "selection" : chosen ? "block" : "page";
export function commentTarget() {
  const link = $("comment-page");
  const button = $("comment-here");
  /* An open dialog hides the button in CSS, which no open path can forget. */
  const usable = editable && !page.pending && !$("reading").hidden;
  const open = usable && noteEditable();
  link.hidden = !usable;
  link.disabled = !open;
  link.querySelector("span").textContent = open
    ? "Comment on this page"
    : "Comments sent";
  const on = open ? target() : "none";
  if (on === "page") link.setAttribute("aria-keyshortcuts", "c");
  else link.removeAttribute("aria-keyshortcuts");
  button.dataset.on = on;
  button.querySelector("span").textContent =
    on === "block" ? `Comment on ${blockKind(chosen)}` : "Comment";
  placeBar();
}
/* One line of the selection as one box, from the selected parts of the
   top line or the bottom one, such as a bold word and the text after it. */
function lineBox(boxes, top) {
  const edge = boxes.reduce((a, b) =>
    top ? (b.top < a.top ? b : a) : b.bottom > a.bottom ? b : a,
  );
  const line = boxes.filter((box) =>
    top ? box.top < edge.bottom : box.bottom > edge.top,
  );
  return {
    top: edge.top,
    bottom: edge.bottom,
    left: Math.min(...line.map((box) => box.left)),
    right: Math.max(...line.map((box) => box.right)),
  };
}
/* The button sits just above what it comments on: centered over the
   selection's top line, or at the chosen block's right edge. It is placed
   in the page, so it scrolls with the words, and kept inside the visible
   column. Where the room above is out of view or holds the page's title or
   its link, it goes below the selection's last line or the block instead,
   so it never covers the words. */
function placeButton() {
  const button = $("comment-here");
  const on = button.dataset.on;
  const selection = getSelection();
  const boxes =
    on === "selection" && selection.rangeCount
      ? [...selection.getRangeAt(0).getClientRects()].filter(
          (box) => box.width && box.height,
        )
      : [];
  button.hidden = on === "block" ? !chosen : !boxes.length;
  if (button.hidden) return;
  const gap = 6;
  const edge = 8;
  const { offsetWidth: width, offsetHeight: height } = button;
  const view = scroller().getBoundingClientRect();
  const block = on === "block" && chosen.getBoundingClientRect();
  const place = (line, above) => ({
    top: above ? line.top - gap - height : line.bottom + gap,
    left: Math.max(
      view.left + edge,
      Math.min(
        block ? line.right - width : (line.left + line.right - width) / 2,
        Math.min(view.right, innerWidth) - edge - width,
      ),
    ),
  });
  const title = document.createRange();
  title.selectNodeContents($("page-title"));
  const taken = [
    ...title.getClientRects(),
    $("comment-page").getBoundingClientRect(),
  ];
  const blocked = ({ top, left }) =>
    top < view.top ||
    taken.some(
      (box) =>
        box.width &&
        top < box.bottom &&
        top + height > box.top &&
        left < box.right &&
        left + width > box.left,
    );
  let spot = place(block || lineBox(boxes, true), true);
  if (blocked(spot)) spot = place(block || lineBox(boxes, false), false);
  const host = $("reading").getBoundingClientRect();
  button.style.top = `${Math.round(spot.top - host.top)}px`;
  button.style.left = `${Math.round(spot.left - host.left)}px`;
}
/* The button, the link and the c key comment on the same things, so they
   share the one function that opens the note. */
export function commentOnTarget(on = target()) {
  if (!noteEditable() || page.pending) return;
  if (on === "selection")
    openNote(
      page.id,
      page.title,
      selected,
      null,
      null,
      selectedTarget,
      selectedOccurrence(getSelection(), selected, selectedTarget),
    );
  else if (on === "block") {
    /* No quote: the note is about the block, and a quote would be searched
       for in the page and highlighted, marking the block's opening words.
       A figure the frame drew around a block has no ID of its own, so the
       note takes the ID of the block inside it. */
    openNote(
      page.id,
      blockHeading(chosen),
      "",
      null,
      null,
      chosen.id || chosen.querySelector("[id]")?.id || null,
    );
  } else openNote(page.id, page.title);
  chooseBlock(null);
}
export function installBlocks() {
  document.addEventListener("selectionchange", () => {
    const selection = getSelection(),
      parent = selection?.anchorNode?.parentElement;
    selected =
      parent?.closest("#page-content") && !parent.closest("pair-thread")
        ? selection?.toString().trim() || ""
        : "";
    selectedTarget = parent?.closest("#page-content [id]")?.id || null;
    commentTarget();
  });
  /* A control does its own job, a block becomes the target, and anything else
     clears it. A drag is a selection, so it never reaches here as a press. */
  $("page-content").addEventListener("click", (event) => {
    if (!noteEditable() || page.pending) return;
    if (
      event.target.closest("button, a, input, label, select, textarea, summary")
    )
      return;
    if (getSelection()?.toString().trim()) return;
    // A thread's card is no block.
    const block =
      !event.target.closest("pair-thread") &&
      event.target.closest("#page-content > *");
    // A paragraph, a heading or a list is commented on by selecting its words.
    chooseBlock(block && !blockSkip.has(block.tagName) ? block : null);
  });
  // A press on the button would otherwise clear the selection it is for.
  $("comment-here").onpointerdown = (event) => event.preventDefault();
  $("comment-here").onclick = () => commentOnTarget();
  $("comment-page").onclick = () => commentOnTarget("page");
  $("overall-note").onclick = () => openNote("overall", "Overall feedback");
  $("note-text").oninput = () => {
    (state.noteDrafts ||= {})[noteDraftKey] = $("note-text").value;
    persist();
  };
}
