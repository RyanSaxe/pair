import { persist, state } from "#frame/app/store.mjs";
import { $, normalize } from "#frame/app/util.mjs";
import { editable, feedbackEditable, page } from "#frame/app/view.mjs";
import { noteDraftKey, openNote } from "#frame/notes/notes.mjs";

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

/* Choices, checklists, answers */
// A note on a block carries the block's ID so Feedback can jump back to it.
export function blockTargets(root, topic) {
  [...root.children].forEach((block, index) => {
    if (!blockSkip.has(block.tagName)) block.id ||= `block-${topic}-${index}`;
  });
}
/* One button, three meanings: the selection, the block you chose, or the
   page. Nothing is drawn on a block except the bar marking the chosen one. */
export let chosen = null;
export function placeBar() {
  const bar = $("chosen-bar");
  bar.hidden = !chosen;
  if (!chosen) return;
  const host = $("reading").getBoundingClientRect();
  const box = chosen.getBoundingClientRect();
  bar.style.top = `${Math.round(box.top - host.top)}px`;
  bar.style.height = `${Math.round(box.height)}px`;
}
export function chooseBlock(block) {
  chosen = block && block !== chosen ? block : null;
  placeBar();
  commentTarget();
}
/* The button names what kind of thing it will comment on; the note itself
   still records the block's own heading. */
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
export function commentTarget() {
  const button = $("quote");
  /* An open dialog hides the control in CSS, which no open path can forget. */
  const usable = editable && !page.pending && !$("reading").hidden;
  button.hidden = !usable;
  if (!usable) return;
  button.disabled = !feedbackEditable();
  if (button.disabled) {
    button.textContent = "Comments sent";
    return;
  }
  if (selected.length > 3) button.textContent = "Comment on selection";
  else if (chosen) button.textContent = `Comment on ${blockKind(chosen)}`;
  else button.textContent = "Comment on this page";
}
/* The control and the c key comment on the same thing, so they share the
   one function that decides what that is. */
export function commentOnTarget() {
  if (!feedbackEditable() || page.pending) return;
  if (selected.length > 3)
    openNote(page.id, page.title, selected, null, null, selectedTarget);
  else if (chosen) {
    /* No quote: the note is about the block, and a quote would be searched
       for in the page and highlighted, marking the block's opening words. */
    openNote(page.id, blockHeading(chosen), "", null, null, chosen.id);
  } else openNote(page.id, page.title);
  chooseBlock(null);
}
export function installBlocks() {
  document.addEventListener("selectionchange", () => {
    const selection = getSelection(),
      parent = selection?.anchorNode?.parentElement;
    selected = parent?.closest("#page-content")
      ? selection?.toString().trim() || ""
      : "";
    selectedTarget = parent?.closest("#page-content [id]")?.id || null;
    commentTarget();
  });
  /* A control does its own job, a block becomes the target, and anything else
     clears it. A drag is a selection, so it never reaches here as a press. */
  $("page-content").addEventListener("click", (event) => {
    if (!feedbackEditable() || page.pending) return;
    if (
      event.target.closest("button, a, input, label, select, textarea, summary")
    )
      return;
    if (getSelection()?.toString().trim()) return;
    const block = event.target.closest("#page-content > *");
    // A paragraph, a heading or a list is commented on by selecting its words.
    chooseBlock(block && !blockSkip.has(block.tagName) ? block : null);
  });
  $("quote").onpointerdown = (event) => event.preventDefault();
  $("quote").onclick = commentOnTarget;
  $("overall-note").onclick = () => openNote("overall", "Overall feedback");
  $("note-text").oninput = () => {
    (state.noteDrafts ||= {})[noteDraftKey] = $("note-text").value;
    persist();
  };
}
