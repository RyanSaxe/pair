import { normalize, plural } from "#frame/app/util.mjs";
import { findQuote } from "#frame/notes/notes.mjs";

/* A thread card's head, which names what the thread is on: the block its
   note is on, or the part of the block its words are in, such as a table
   row or a line of code. Naming reads only markup any component may use,
   so a reviewer's own components are named the same way. */

const stateWords = (thread) =>
  thread.error
    ? "Not sent"
    : {
        sending: "Sending",
        sent: "Sent to the agent",
        read: "Agent replying",
        replied: "Agent replied",
        failed: "Could not reach the agent",
      }[thread.state];
const cut = (text, length) =>
  text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
// What a thread is on, as its card's head names it.
function threadName(thread, part, collapsed) {
  if (thread.proposal) return `On ${thread.page}`;
  if (thread.quote) {
    // A collapsed card hides its quote, so its head quotes the words.
    const words = `“${cut(normalize(thread.quote), 40)}”`;
    if (collapsed) return part ? `On ${words} in ${part}` : `On ${words}`;
    return part ? `On ${part}` : "On the words you selected";
  }
  if (thread.agreementId === "task") return "On the task";
  if (thread.anchor === thread.page) return "On this page";
  return `On ${thread.anchor}`;
}
// A card's head: what the thread is on, how many messages it has, and its
// state when the card is collapsed. part names the part of the block the
// thread's words are in, such as "row Read", or is null.
export function threadTitle(thread, part, collapsed) {
  const count = plural(thread.messages.length, "message");
  return {
    name: threadName(thread, part, collapsed),
    meta: collapsed ? `${count} · ${stateWords(thread)}` : count,
  };
}

// The part of its block a thread's words are in, named for the card's head:
// a table row by its first cell, a line of code by its place in the block,
// and a decision option or a checklist item by its label. Words anywhere
// else, such as in a paragraph or a figure's labels, have no part.
export function partOf(block, thread) {
  const range =
    block &&
    thread.quote &&
    findQuote(thread.quote, thread.target, thread.occurrence);
  if (!range || !block.contains(range.startContainer)) return null;
  for (
    let at = range.startContainer.parentElement;
    at !== block;
    at = at.parentElement
  ) {
    const first = at.localName === "tr" && normalize(at.cells[0]?.textContent);
    if (first) return `row ${first}`;
    if (at.matches(".shiki code .line")) {
      const lines = [...at.closest(".shiki").querySelectorAll("code .line")];
      return `line ${lines.indexOf(at) + 1}`;
    }
    // A checklist row holds its checkbox, where a decision option is the
    // element that has the value.
    const list = at.parentElement.closest("[data-multiselect]");
    const values = list ? at.querySelectorAll("[data-value]") : [];
    const value = at.matches("[data-value]")
      ? at
      : values.length === 1 && values[0];
    if (value)
      return `${list ? "item" : "option"} ${value.dataset.label || value.dataset.value}`;
  }
  return null;
}
