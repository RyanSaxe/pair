import { ago } from "#frame/app/time.mjs";

export const $ = (id) => document.getElementById(id);
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
export const hubUnreachable = "The hub is unreachable. Try again shortly.";
// A request the hub never answered rejects with a TypeError; any other
// error carries the hub's own reason.
export const unreachable = (error, message = hubUnreachable) =>
  error instanceof TypeError ? message : error.message;
export const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
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
