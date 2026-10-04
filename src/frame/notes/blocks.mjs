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
   page's layout changes, so it also places the comment control, which
   centers itself in the gutter beside the page's text. */
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
/* The comment control names what kind of block it will comment on; the note
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
/* The c key and the comment control comment on the selection, then the
   chosen block, then the page. */
const target = () =>
  selected.length > 3 ? "selection" : chosen ? "block" : "page";
export function commentTarget() {
  const button = $("comment-here");
  /* An open dialog hides the control in CSS, which no open path can forget. */
  const usable =
    editable && !page.pending && !$("reading").hidden && noteEditable();
  button.hidden = !usable;
  const on = usable ? target() : "none";
  button.dataset.on = on;
  const name =
    on === "selection"
      ? "Comment on selection"
      : on === "block"
        ? `Comment on ${blockKind(chosen)}`
        : "Comment on this page";
  button.setAttribute("aria-label", name);
  /* The page's icon shows no label, and the label it shrinks from stays
     until it has shrunk. */
  if (on === "selection" || on === "block")
    button.querySelector(".comment-label span").textContent = name;
  placeBar();
}
/* On a window wide enough, the control sits in the gutter between the
   page's text and the window's right edge, centered across it, so it never
   covers the text at rest. Where the gutter is narrower than the control,
   as on a phone, it sits at the bottom right over the page. It grows
   leftward from that right edge. */
function placeButton() {
  const button = $("comment-here");
  if (button.hidden) return;
  // At rest the control is a circle, so its height is its width.
  const size = parseFloat(getComputedStyle(button).height);
  const gutter =
    document.documentElement.clientWidth -
    $("page-content").getBoundingClientRect().right;
  const fits = gutter >= size;
  button.dataset.place = fits ? "gutter" : "corner";
  button.style.right = fits ? `${(gutter - size) / 2}px` : "";
}
/* The control and the c key comment on the same things, so they share the
   one function that opens the note. */
export function commentOnTarget() {
  if (!noteEditable() || page.pending) return;
  const on = target();
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
  /* Once the frame is at its widest, a wider window widens the gutter and
     leaves the page's size as it was, so no layout change places it. */
  addEventListener("resize", placeButton);
  $("overall-note").onclick = () => openNote("overall", "Overall feedback");
  $("note-text").oninput = () => {
    (state.noteDrafts ||= {})[noteDraftKey] = $("note-text").value;
    persist();
  };
}
