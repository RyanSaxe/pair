import { base, editable } from "#frame/app/view.mjs";
import { acknowledgeReply } from "#frame/sync/center.mjs";

/* The hub sends no wake event for a thumbs up. The frame leaves a reply
   that has a thumbs up out of the bell's list. */

// wanted maps "threadId/index" to each thumbs up that this browser set and
// the hub's poll does not show yet.
const wanted = new Map();
const icon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';

const pressed = (thread, index) =>
  wanted.get(`${thread.id}/${index}`) ??
  Boolean(thread.messages[index]?.acknowledgedAt);
const isPressed = (button) => button.getAttribute("aria-pressed") === "true";
function show(button, on) {
  button.setAttribute("aria-pressed", String(on));
  button.title = on ? "Remove your thumbs up" : "Thumbs up";
  button.hidden = !editable && !on;
}
export function ackButton(thread, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thread-ack";
  button.dataset.index = String(index);
  button.setAttribute("aria-label", "Thumbs up");
  button.innerHTML = icon;
  button.disabled = !editable;
  button.onclick = () =>
    void toggle(button, thread.id, index, !isPressed(button));
  show(button, pressed(thread, index));
  return button;
}
// syncAcks runs on each poll. It sets each button from the hub's copy of the
// thread, or from wanted until the hub's copy matches it.
export function syncAcks(card, thread) {
  for (const button of card.querySelectorAll(".thread-ack")) {
    const index = Number(button.dataset.index);
    const key = `${thread.id}/${index}`;
    if (wanted.get(key) === Boolean(thread.messages[index]?.acknowledgedAt))
      wanted.delete(key);
    show(button, pressed(thread, index));
  }
}
async function toggle(button, threadId, index, on) {
  const key = `${threadId}/${index}`;
  wanted.set(key, on);
  show(button, on);
  acknowledgeReply(threadId, index, on);
  try {
    const response = await fetch(
      `${base}/api/threads/${encodeURIComponent(threadId)}/acknowledge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: index, acknowledged: on }),
      },
    );
    if (!response.ok) throw Error((await response.json()).error);
  } catch {
    // The hub kept its old value, so toggle restores the button and the bell.
    if (wanted.get(key) !== on) return;
    wanted.delete(key);
    show(button, !on);
    acknowledgeReply(threadId, index, !on);
  }
}
