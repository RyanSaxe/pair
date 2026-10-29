import { persist, state } from "#frame/app/store.mjs";
import { $, normalize } from "#frame/app/util.mjs";
import {
  agreements,
  editable,
  feedbackEditable,
  noteEditable,
  page,
} from "#frame/app/view.mjs";
import {
  noteDraftKey,
  openNote,
  selectedOccurrence,
} from "#frame/notes/notes.mjs";
import { diagramBox } from "#frame/pages/diagram.mjs";
import { cardsEditable } from "#frame/pages/work.mjs";
import { diffLineForNode, selectionAnchor } from "#frame/pages/renderers.mjs";
import { remote } from "#frame/sync/rounds.mjs";

let selected = "";
let selectedTarget = null;
let selectedDiffLine = null;
let selectedBox = null;
function composedParent(node) {
  const root = node?.getRootNode?.();
  return node?.parentElement || root?.host || null;
}
function pageBlock(node) {
  const root = $("page-content");
  for (
    let at = node?.nodeType === 1 ? node : node?.parentElement;
    at && at !== root;
    at = composedParent(at)
  )
    if (at.parentElement === root) return at;
  return null;
}
function selectionTarget(node, block, diffLine) {
  for (
    let at = node?.nodeType === 1 ? node : node?.parentElement;
    at && at.id !== "page-content";
    at = composedParent(at)
  )
    if (at.id) return at.id;
  if (!diffLine || !block) return block?.id || null;
  if (!block.id) {
    const root = $("page-content");
    const index = [...root.children].indexOf(block) + 1;
    block.id = `pair-diff-${index}`;
  }
  return block.id;
}
function boxOf(selection) {
  const at = (node) =>
    node?.parentElement?.closest("[data-diagram] .pele-node");
  const box = at(selection?.anchorNode);
  const found = box === at(selection?.focusNode) && diagramBox(box);
  return found ? { ...found, diagram: box.closest("[data-diagram]") } : null;
}
function insideThread(node) {
  for (
    let at = node?.nodeType === 1 ? node : node?.parentElement;
    at;
    at = composedParent(at)
  )
    if (at.localName === "pair-thread") return true;
  return false;
}
// The frame treats every other direct child of the page content as a block
// that the reviewer can choose and comment on. Paragraphs, headings and lists
// are left out because the reviewer comments on their text by selecting it.
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
  // threads.mjs inserts each pair-thread element between blocks, and that
  // element is not a block.
  "PAIR-THREAD",
]);
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
  /* blockName gives two blocks under one heading, or two blocks of one kind
     with no heading, the same name. Feedback lists their notes with nothing
     else to tell them apart, so blockHeading numbers the blocks whose names
     match. */
  const peers = [...block.parentElement.children].filter(
    (other) => !blockSkip.has(other.tagName) && blockName(other) === name,
  );
  return peers.length < 2 ? name : `${name} ${peers.indexOf(block) + 1}`;
}
function blockName(block) {
  const read = (node) => normalize(node?.textContent);
  /* blockName never uses the block's own text, because that text includes a
     table's cells, a renderer's injected stylesheet and its buttons. */
  const named = "[data-title], [data-caption], [data-file]";
  const titled = block.matches(named) ? block : block.querySelector(named);
  /* A heading inside a details element names a section of the block, not
     the block. The diff's "Before" and "Git patch" headings are inside one. */
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
    /* The reviewer reads this name on Feedback and the agent reads it as
       text, and neither sees the block there. A block with no name of its
       own falls back to the heading above it, then to its kind. */
    read(headingAbove(block)) ||
    sentence(blockKind(block));
  return name.length > 60 ? name.slice(0, 57) + "…" : name;
}

/* A note on a block includes the block's ID, so Feedback can open the page
   at the block. A paragraph, heading or list gets an ID too, so a note or
   thread on words selected in it records that block, even when an earlier
   block contains the same words. */
export function blockTargets(root, topic) {
  [...root.children].forEach((block, index) => {
    block.id ||= `block-${topic}-${index}`;
  });
}
// A unit is a block, a Work card or an Agreed card, which the reviewer can
// choose with a click or the j and k keys.
const units =
  "#work-cards > [data-proposal-card], #page-content .agreement-card, #page-content > *";
export function choosable() {
  if (!$("review-view").hidden) return [];
  const found = !$("work-view").hidden
    ? $("work-cards").querySelectorAll(":scope > [data-proposal-card]")
    : page.id === "agreed"
      ? $("page-content").querySelectorAll(".agreement-card")
      : $("page-content").children;
  return [...found].filter(
    (unit) => !blockSkip.has(unit.tagName) && unit.offsetParent,
  );
}
function unitAt(node) {
  if (node.closest("pair-thread")) return null;
  const unit = node.closest(units);
  if (unit?.closest("#page-content") && page.id === "agreed")
    return unit.matches(".agreement-card") ? unit : null;
  return unit && !blockSkip.has(unit.tagName) ? unit : null;
}
const cardOf = (unit) =>
  unit?.dataset.proposalCard &&
  remote?.proposals?.find((card) => card.id === unit.dataset.proposalCard);
// The reviewer can comment on a proposal wherever its Start button works,
// and on anything else only where a note can open.
const opens = (unit) =>
  cardOf(unit) ? feedbackEditable() || cardsEditable() : noteEditable();
/* placeMarks() calls placeBar whenever the page's layout changes, and the
   Work page calls it through commentTarget after drawing its cards, so
   placeBar also places the comment control. */
export let chosen = null;
export function placeBar() {
  const bar = $("chosen-bar");
  bar.hidden = !chosen;
  placeButton();
  if (!chosen) return;
  const host = chosen.closest("#reading, #work-view");
  if (bar.parentElement !== host) host.prepend(bar);
  const top = host.getBoundingClientRect().top;
  const box = chosen.getBoundingClientRect();
  bar.style.top = `${Math.round(box.top - top)}px`;
  bar.style.height = `${Math.round(box.height)}px`;
}
export function chooseBlock(block) {
  chosen = block && block !== chosen ? block : null;
  commentTarget();
}
function blockKind(block) {
  const has = (selector) =>
    block.matches(selector) || block.querySelector(selector) !== null;
  /* A component declares its kind in data-kind, so the frame never depends
     on a component's class. The checks below use only attributes and
     elements that any component can use. */
  const declared = block.closest("[data-kind]")?.dataset.kind;
  if (declared) return `this ${declared}`;
  /* The checks test what the block is before what it contains, so a decision
     whose options are diagrams is still a decision. The figure check comes
     last because every diagram and chart contains a figure. */
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
function target() {
  if (!$("review-view").hidden) return "overall";
  if (!$("work-view").hidden) return chosen ? "block" : "work";
  return selected.length > 3 ? "selection" : chosen ? "block" : "page";
}
function usable(on) {
  if (!editable || (!$("reading").hidden && page.pending)) return false;
  return on === "block" ? opens(chosen) : noteEditable();
}
const names = {
  selection: "Comment on selection",
  page: "Comment on this page",
  work: "Comment on Work",
  overall: "Add overall comment",
};
export function commentTarget() {
  // The Work page draws its cards again when they change, so commentTarget
  // finds the chosen card again by its ID. The choice ends when the open tab
  // no longer lists the card.
  if (chosen && !chosen.isConnected) {
    const id = chosen.dataset.proposalCard;
    chosen =
      (!$("work-view").hidden &&
        id &&
        $("work-cards").querySelector(
          `:scope > [data-proposal-card="${CSS.escape(id)}"]`,
        )) ||
      null;
  }
  const button = $("comment-here");
  const on = target();
  /* CSS hides the control while a dialog is open, so no code that opens a
     dialog has to hide it. */
  button.hidden = !usable(on);
  const grows = on === "selection" || on === "block";
  button.dataset.on = button.hidden ? "none" : grows ? on : "page";
  const name = on === "block" ? `Comment on ${blockKind(chosen)}` : names[on];
  button.setAttribute("aria-label", name);
  /* commentTarget leaves the label text as it is when the control shrinks to
     an icon, so the old label shows until the control has shrunk. */
  if (grows) button.querySelector(".comment-label span").textContent = name;
  placeBar();
}
/* placeButton centers the control in the margin right of the text when the
   margin is wide enough, so the control never covers the text at rest. */
function placeButton() {
  const button = $("comment-here");
  if (button.hidden) return;
  // At rest the control is a circle, so its height is its width.
  const size = parseFloat(getComputedStyle(button).height);
  const shown = [$("reading"), $("review-view"), $("work-view")].find(
    (view) => !view.hidden,
  );
  const text = shown.getBoundingClientRect().right;
  const edge = $("content").getBoundingClientRect().right;
  const fits = edge - text >= size;
  const width = document.documentElement.clientWidth;
  button.dataset.place = fits ? "gutter" : "corner";
  button.style.right = fits
    ? `${width - edge + (edge - text - size) / 2}px`
    : "";
}
function chosenNote() {
  const card = cardOf(chosen);
  const onWork = !$("work-view").hidden;
  /* A note on a proposal includes the card's ID, so the note's Start a
     thread starts the card's own thread. On a page the note also includes
     the component's ID, so Review can open the page at the component. */
  if (card)
    return onWork
      ? { topic: "work", anchor: card.title, proposal: card.id }
      : {
          topic: page.id,
          anchor: card.title,
          proposal: card.id,
          target: chosen.id,
        };
  if (chosen.matches(".agreement-card")) {
    const entry =
      chosen.id === "agreement-task"
        ? { id: "task", title: "The task" }
        : agreements.find((item) => `agreement-${item.id}` === chosen.id);
    return {
      topic: "agreed",
      anchor: entry.title,
      agreementId: entry.id,
      target: chosen.id,
    };
  }
  /* The note has no quote, because the frame searches the page for a quote
     and highlights it, which would mark only the block's opening words. A
     figure the frame drew around a block has no ID, so the note uses the ID
     of the block inside it. */
  return {
    topic: page.id,
    anchor: blockHeading(chosen),
    target: chosen.id || chosen.querySelector("[id]")?.id || null,
  };
}
export function commentOnTarget() {
  const on = target();
  if (!usable(on)) return;
  if (on === "overall")
    openNote({ topic: "overall", anchor: "Overall feedback" });
  else if (on === "work") openNote({ topic: "work", anchor: "Work" });
  else if (on === "selection" && selectedBox)
    commentOn(selectedBox.diagram, {
      quote: selectedBox.label,
      diagramNode: selectedBox.id,
    });
  else if (on === "selection")
    openNote({
      topic: page.id,
      anchor: page.title,
      quote: selected,
      target: selectedTarget,
      occurrence: selectedOccurrence(getSelection(), selected, selectedTarget),
      diffLine: selectedDiffLine,
    });
  else if (on === "block") openNote(chosenNote());
  else openNote({ topic: page.id, anchor: page.title });
  chooseBlock(null);
}
/* A component calls commentOn to open a note on one part of a block, such
   as one box of a diagram, after canComment returns true. The note's anchor
   is the block's name, as for a note on the whole block. */
export const canComment = () => usable("selection");
export function partName(element) {
  const block = pageBlock(element);
  return block ? blockHeading(block) : page.title;
}
export function commentOn(element, fields) {
  openNote({
    topic: page.id,
    anchor: partName(element),
    target: element?.id || null,
    ...fields,
  });
}
export function installBlocks() {
  document.addEventListener("selectionchange", () => {
    const selection = getSelection();
    const block = pageBlock(selection?.anchorNode);
    selected =
      block && !insideThread(selection?.anchorNode)
        ? selection?.toString().trim() || ""
        : "";
    selectedDiffLine = selected
      ? diffLineForNode(selectionAnchor(selection))
      : null;
    selectedBox = selected ? boxOf(selection) : null;
    selectedTarget = selectionTarget(
      selection?.anchorNode,
      block,
      selectedDiffLine,
    );
    commentTarget();
  });
  /* A drag leaves text selected, so choose returns and the drag stays a
     selection. */
  const choose = (event) => {
    if (!editable || (!$("reading").hidden && page.pending)) return;
    if (
      event.target.closest("button, a, input, label, select, textarea, summary")
    )
      return;
    if (getSelection()?.toString().trim()) return;
    const unit = unitAt(event.target);
    if (unit && !opens(unit)) return;
    chooseBlock(unit);
  };
  $("page-content").addEventListener("click", choose);
  $("work-cards").addEventListener("click", choose);
  // Without preventDefault, a press on the button clears the selection that
  // the button comments on.
  $("comment-here").onpointerdown = (event) => event.preventDefault();
  $("comment-here").onclick = () => commentOnTarget();
  /* Once the frame is at its widest, a wider window moves the page's edge
     without changing the page's size, so placeMarks does not run and the
     button needs its own resize listener. */
  addEventListener("resize", placeButton);
  $("note-text").oninput = () => {
    (state.noteDrafts ||= {})[noteDraftKey] = $("note-text").value;
    persist();
  };
}
