import { ago } from "#frame/app/time.mjs";

/* A page's markup can reuse an ID the frame uses, such as a section with
   id="work". The page content comes before Work, Review and the dialogs in
   the document, so getElementById would return the page's element, and the
   frame would show and hide that element in place of its own. $ returns
   the frame's element whenever the frame has one. */
export function $(id) {
  const found = document.getElementById(id);
  const content = document.getElementById("page-content");
  if (!found || found === content || !content?.contains(found)) return found;
  for (const element of document.querySelectorAll(`#${CSS.escape(id)}`))
    if (!content.contains(element)) return element;
  return found;
}
// crypto.randomUUID exists only in a secure context; over plain http on a
// Tailscale address, which is how a phone reaches the hub, it is undefined.
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
// The key a page's choice, checklist or question is kept under in a draft.
export const controlKey = (topic, id) => `${topic}/${id}`;
// Shift+Enter presses the main button under a text box, except one that
// sends to the agent at once, which ⌘ Enter presses (sendKey in threads.mjs).
export const shiftEnter = (event) =>
  event.key === "Enter" &&
  event.shiftKey &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.altKey;
export const hubUnreachable = "The hub is unreachable. Try again shortly.";
// A request the hub never answered rejects with a TypeError; any other
// error carries the hub's own reason.
export const unreachable = (error, message = hubUnreachable) =>
  error instanceof TypeError ? message : error.message;
export const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
// A note's occurrence is which appearance of its words in its block the
// reviewer selected, counting from 1. occurrenceAt gives the appearance of
// needle in text that begins at start or later, and occurrenceIndex gives
// where an appearance begins, or -1.
export function occurrenceAt(text, needle, start) {
  let occurrence = 1;
  for (
    let index = text.indexOf(needle);
    index >= 0 && index < start;
    index = text.indexOf(needle, index + 1)
  )
    occurrence++;
  return occurrence;
}
export function occurrenceIndex(text, needle, occurrence = 1) {
  let index = text.indexOf(needle);
  for (let seen = 1; seen < occurrence && index >= 0; seen++)
    index = text.indexOf(needle, index + 1);
  return index;
}
export const plural = (count, word) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
// The activity card counts seconds in its first minute, so a fresh report
// visibly ticks up while the agent works.
export function recently(value) {
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  if (ms < 5000) return "just now";
  return ms < 60000 ? `${Math.round(ms / 1000)} s ago` : ago(value);
}
// Over plain http, which is how a phone reaches the hub, the browser has no
// clipboard API, so the text is copied from a field selected for a moment.
// The field goes inside an open dialog, because a modal makes the rest of
// the page inert.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const focused = document.activeElement;
    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true;
    field.style.position = "fixed";
    field.style.opacity = "0";
    (document.querySelector("dialog[open]") || document.body).append(field);
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      field.remove();
      focused?.focus();
    }
  }
}
