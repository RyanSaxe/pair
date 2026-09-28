import { offers } from "#shared/offers.mjs";
import { ago, since } from "#frame/app/time.mjs";
import { $, copyText } from "#frame/app/util.mjs";
import { mode, online, session } from "#frame/app/view.mjs";
import { handoffLine } from "#frame/pages/renderers.mjs";
import { installCenter, renderCenter } from "#frame/sync/center.mjs";
import { createReviewAlerts } from "#frame/sync/notifications.mjs";
import { connected, remote } from "#frame/sync/rounds.mjs";

let sessions = [];
export let sessionOrder = [];
let reviewAlerts;
export function installSessions() {
  reviewAlerts = createReviewAlerts({
    window,
    button: $("notifications"),
    sessionId: session.sessionId,
    open: (href) => location.assign(new URL(href, location.href).href),
  });
  installCenter();
}
export function status() {
  // The hub exits once no session is live, so a tab keeps the stage it last
  // saw: a saved or accepted round keeps its banner while the hub is gone.
  const saved = remote?.stage === "saved";
  const complete = remote?.stage === "complete" && remote?.accepted;
  $("accepted").hidden = !saved && !complete;
  // A saved round waits for an agent to build it, so the banner gives the
  // line that hands it over.
  if (saved) {
    const { round, offer } = remote.current;
    const chosen = offers[offer].accept.actions.find(
      (item) => item.after === "saved",
    );
    const text = `Round ${round} accepted: ${chosen.label}.`;
    if ($("accepted").firstChild?.textContent !== text)
      $("accepted").replaceChildren(text, handoffLine(remote.handoff));
  } else if (complete) {
    const { round, offer, action, path } = remote.accepted;
    const chosen = offers[offer].accept.actions.find(
      (item) => item.id === action,
    );
    $("accepted").textContent =
      `Round ${round} accepted: ${chosen.label}. Saved at ${path}`;
  }
  $("connection-status").textContent = !online
    ? "Local viewing. Feedback can be exported; live submission requires the session URL."
    : !connected
      ? "The hub is unreachable. Your draft stays here and submits when it is back."
      : "";
  // A session closed from another tab reloads into read-only, so this tab
  // cannot send anything to an agent that will never be woken again.
  if (remote?.dismissedAt && mode === "live") location.reload();
}
export async function pollSessions() {
  let fromHub = false;
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) throw Error();
    sessions = (await response.json()).sessions || [];
    fromHub = true;
  } catch {
    sessions = [];
  }
  // Waiting sessions first, then the rest by their last change, as the hub
  // lists them, and this tab last.
  sessionOrder = [
    ...sessions.filter((entry) => entry.id !== session.sessionId),
    ...sessions.filter((entry) => entry.id === session.sessionId),
  ];
  renderSessions();
  renderCenter(sessions, fromHub);
  void reviewAlerts.update(sessions);
}
export function stateWords(entry) {
  if (entry.needsYou)
    return entry.offer ? "Ready to accept" : "Waiting for you";
  if (entry.paused) return "Paused";
  if (entry.stage === "saved") return "Saved";
  if (entry.openRound)
    return `Working · ${entry.openRound.ready} pages readable`;
  if (["submitted", "working"].includes(entry.stage))
    return `Working · ${since(entry.updatedAt)}`;
  return "Live";
}
const copyIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
// An icon button on a line. Its tooltip is part of the button, so hover and
// focus show it and the pointer can rest on it.
export function lineButton(key, label, content, onclick, tip = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn";
  button.dataset.key = key;
  button.setAttribute("aria-label", label);
  button.innerHTML = content;
  if (tip) {
    const text = document.createElement("span");
    text.className = "line-tip";
    text.setAttribute("aria-hidden", "true");
    text.textContent = tip;
    button.append(text);
  }
  button.onclick = () => onclick(button);
  return button;
}
/* One line of the notification center or of Live sessions: a row with a
   title and a words line, whose tint says what it is, then its icon
   buttons, each in a fixed column under the dialog's own ✕. An empty slot
   keeps a later button in its column. */
export function sessionLine({ key, title, state, words, tint, open, icons }) {
  const line = document.createElement("div");
  line.className = `session-line ${tint}`.trim();
  const row = document.createElement("button");
  row.type = "button";
  row.className = `session-row ${tint}`.trim();
  row.dataset.key = key;
  const name = document.createElement("span");
  name.className = "title";
  name.textContent = title;
  const line2 = document.createElement("span");
  line2.className = "words";
  if (state) {
    const em = document.createElement("em");
    em.textContent = state;
    line2.append(em);
  }
  line2.append(words);
  row.append(name, line2);
  row.onclick = open;
  line.append(row);
  for (const icon of icons) line.append(icon || document.createElement("span"));
  return line;
}
/* A poll redraws a list only when what it shows changed, and keeps focus on
   the same row or button, so Tab and Enter work through a list that
   refreshes every few seconds. When that button is gone, as a cleared
   event's is, focus stays at its place in the list. */
export function redraw(list, lines) {
  const next = document.createElement("div");
  next.append(...lines);
  if (next.innerHTML === list.innerHTML) return;
  const keyed = () => [...list.querySelectorAll("[data-key]")];
  const focused = keyed().indexOf(document.activeElement);
  const key = document.activeElement?.dataset.key;
  list.replaceChildren(...next.childNodes);
  if (focused < 0) return;
  const now = keyed();
  (
    now.find((element) => element.dataset.key === key) ||
    now.at(focused) ||
    now.at(-1)
  )?.focus();
}
// Every session, in sessionOrder. Each row copies its handoff line, and
// every row but this tab's closes its session.
function renderSessions() {
  const lines = sessionOrder.map((entry) => {
    const current = entry.id === session.sessionId;
    const copy = lineButton(
      `copy:${entry.id}`,
      `Copy handoff line for ${entry.title}`,
      copyIcon,
      async (button) => {
        const tip = button.querySelector(".line-tip");
        tip.textContent = (await copyText(entry.handoff))
          ? "Copied"
          : "Copy failed";
        button.classList.add("tipped");
        setTimeout(() => {
          button.classList.remove("tipped");
          tip.textContent = "Copy handoff line";
        }, 1500);
      },
      "Copy handoff line",
    );
    const line = sessionLine({
      key: `open:${entry.id}`,
      title: entry.title,
      state: current ? "This tab" : stateWords(entry),
      words: ` · round ${entry.round} · ${ago(entry.updatedAt)}`,
      tint: current ? "current" : entry.needsYou ? "need" : "",
      open: () => {
        if (current) $("sessions-dialog").close();
        else location.assign(entry.url);
      },
      icons: current
        ? [copy]
        : [
            copy,
            lineButton(`close:${entry.id}`, `Close ${entry.title}`, "✕", () =>
              dismiss(entry, line),
            ),
          ],
    });
    return line;
  });
  redraw($("sidecar-list"), lines);
}
/* Two round trips, a dismiss and a poll, so the line says it is going
   before either starts. Without it a slow hub looks like a dead control. */
async function dismiss(entry, line) {
  line.dataset.closing = "true";
  try {
    const response = await fetch(`${entry.url}api/dismiss`, {
      method: "POST",
    });
    if (!response.ok) throw Error();
    await pollSessions();
  } catch {
    delete line.dataset.closing;
    line.querySelector(".words em").textContent = "Could not close";
  }
}
export function showSessions() {
  if ($("center-dialog").open) $("center-dialog").close();
  $("sessions-dialog").showModal();
}
