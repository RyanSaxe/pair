import { normalize, plural } from "#frame/app/util.mjs";
import { findQuote } from "#frame/notes/notes.mjs";

/* threadName and partOf read only markup that any component can use, so
   they name the parts of a user's own components the same way. */

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
function threadName(thread, part, collapsed) {
  if (thread.proposal) return `On ${thread.page}`;
  if (thread.quote) {
    // A collapsed card hides its quote, so the head includes the words.
    const words = `“${cut(normalize(thread.quote), 40)}”`;
    if (collapsed) return part ? `On ${words} in ${part}` : `On ${words}`;
    return part ? `On ${part}` : "On the words you selected";
  }
  if (thread.agreementId === "task") return "On the task";
  if (thread.topic === "overall" || thread.topic === "work")
    return `On ${thread.page}`;
  if (thread.anchor === thread.page) return "On this page";
  return `On ${thread.anchor}`;
}
// part is the name that partOf returns, such as "row Read", or null.
export function threadTitle(thread, part, collapsed) {
  const count = plural(thread.messages.length, "message");
  return {
    name: threadName(thread, part, collapsed),
    meta: collapsed ? `${count} · ${stateWords(thread)}` : count,
  };
}

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
    // In a checklist, the row contains the checkbox that has data-value. In
    // a decision, the option itself has data-value.
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
