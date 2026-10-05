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
import { cardsEditable } from "#frame/pages/work.mjs";
import { remote } from "#frame/sync/rounds.mjs";

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
/* What a click, j or k can choose in the view on screen: the cards on
   Work, the task and each alignment on Agreed, inside the No longer applies
   fold too, and the blocks of any other page. Review has nothing to
   choose. */
const units =
  "#work-cards > [data-proposal-card], #page-content .agreement-card, #page-content > *";
export function choosable() {
  if (!$("feedback").hidden) return [];
  const found = !$("work").hidden
    ? $("work-cards").querySelectorAll(":scope > [data-proposal-card]")
    : page.id === "agreed"
      ? $("page-content").querySelectorAll(".agreement-card")
      : $("page-content").children;
  return [...found].filter(
    (unit) => !blockSkip.has(unit.tagName) && unit.offsetParent,
  );
}
function unitAt(node) {
  // A thread's card is no block.
  if (node.closest("pair-thread")) return null;
  const unit = node.closest(units);
  // Agreed's cards are its only blocks.
  if (unit?.closest("#page-content") && page.id === "agreed")
    return unit.matches(".agreement-card") ? unit : null;
  // A paragraph, a heading or a list is commented on by selecting its words.
  return unit && !blockSkip.has(unit.tagName) ? unit : null;
}
// The proposal a chosen card or proposal component shows, once the frame
// has drawn the hub's card in it.
const cardOf = (unit) =>
  unit?.dataset.proposalCard &&
  remote?.proposals?.find((card) => card.id === unit.dataset.proposalCard);
// A comment on a proposal can start the card's thread wherever its Start
// can, and a comment on anything else opens only while a note can.
const opens = (unit) =>
  cardOf(unit) ? feedbackEditable() || cardsEditable() : noteEditable();
/* The bar marks the chosen block or card. placeMarks() calls this whenever
   the page's layout changes, and Work after it draws its cards, so it also
   places the comment control, which centers itself in the margin beside
   the text. */
export let chosen = null;
export function placeBar() {
  const bar = $("chosen-bar");
  bar.hidden = !chosen;
  placeButton();
  if (!chosen) return;
  const host = chosen.closest("#reading, #work");
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
   chosen block or card, then the page. On Review they comment on the
   round's feedback as a whole, and on Work on Work as a whole. */
function target() {
  if (!$("feedback").hidden) return "overall";
  if (!$("work").hidden) return chosen ? "block" : "work";
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
  // Work draws its cards again when they change, so the chosen card is
  // found again by its ID, and the choice ends when it left the tab.
  if (chosen && !chosen.isConnected) {
    const id = chosen.dataset.proposalCard;
    chosen =
      (!$("work").hidden &&
        id &&
        $("work-cards").querySelector(
          `:scope > [data-proposal-card="${CSS.escape(id)}"]`,
        )) ||
      null;
  }
  const button = $("comment-here");
  const on = target();
  /* An open dialog hides the control in CSS, which no open path can forget. */
  button.hidden = !usable(on);
  // The control grows to name a selection or a chosen block or card, and
  // stays an icon for a page, Review and Work.
  const grows = on === "selection" || on === "block";
  button.dataset.on = button.hidden ? "none" : grows ? on : "page";
  const name = on === "block" ? `Comment on ${blockKind(chosen)}` : names[on];
  button.setAttribute("aria-label", name);
  /* The page's icon shows no label, and the label it shrinks from stays
     until it has shrunk. */
  if (grows) button.querySelector(".comment-label span").textContent = name;
  placeBar();
}
/* On a window wide enough, the control sits in the white margin, centered
   between the end of the text and the page's right edge, so it never covers
   the text at rest. Where the margin is narrower than the control, as on a
   phone, it sits at the bottom right over the page. It grows leftward from
   its right edge, over the text. */
function placeButton() {
  const button = $("comment-here");
  if (button.hidden) return;
  // At rest the control is a circle, so its height is its width.
  const size = parseFloat(getComputedStyle(button).height);
  const shown = [$("reading"), $("feedback"), $("work")].find(
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
// The note a comment on the chosen card or block starts.
function chosenNote() {
  const card = cardOf(chosen);
  const onWork = !$("work").hidden;
  /* A note on a proposal names the card, and its Start a thread starts the
     card's own thread. On a page it keeps the component's ID, so Review
     can open the page at it. */
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
  /* No quote: the note is about the block, and a quote would be searched
     for in the page and highlighted, marking the block's opening words. A
     figure the frame drew around a block has no ID of its own, so the note
     takes the ID of the block inside it. */
  return {
    topic: page.id,
    anchor: blockHeading(chosen),
    target: chosen.id || chosen.querySelector("[id]")?.id || null,
  };
}
/* The control and the c key comment on the same things, so they share the
   one function that opens the note. */
export function commentOnTarget() {
  const on = target();
  if (!usable(on)) return;
  if (on === "overall")
    openNote({ topic: "overall", anchor: "Overall feedback" });
  else if (on === "work") openNote({ topic: "work", anchor: "Work" });
  else if (on === "selection")
    openNote({
      topic: page.id,
      anchor: page.title,
      quote: selected,
      target: selectedTarget,
      occurrence: selectedOccurrence(getSelection(), selected, selectedTarget),
    });
  else if (on === "block") openNote(chosenNote());
  else openNote({ topic: page.id, anchor: page.title });
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
  /* A control does its own job, a block or card becomes the target, and
     anything else clears it. A drag is a selection, so it never reaches
     here as a press. */
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
  // A press on the button would otherwise clear the selection it is for.
  $("comment-here").onpointerdown = (event) => event.preventDefault();
  $("comment-here").onclick = () => commentOnTarget();
  /* Once the frame is at its widest, a wider window moves the page's edge and
     leaves the page's size as it was, so no layout change places it. */
  addEventListener("resize", placeButton);
  $("note-text").oninput = () => {
    (state.noteDrafts ||= {})[noteDraftKey] = $("note-text").value;
    persist();
  };
}
