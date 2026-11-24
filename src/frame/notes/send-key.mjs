import { apple } from "#frame/app/util.mjs";

export const modifier = () => (apple() ? "⌘" : "Ctrl");
export const sendKeyLabel = () => `${modifier()} ↵`;
export const sendKeyName = () => (apple() ? "Meta+Enter" : "Control+Enter");
export const sendKey = (event) =>
  event.key === "Enter" &&
  !event.shiftKey &&
  !event.altKey &&
  (apple() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
