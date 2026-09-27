import { offers } from "#shared/offers.mjs";
import { ago, since } from "#frame/app/time.mjs";
import { $, plural } from "#frame/app/util.mjs";
import { mode, online, plan, session } from "#frame/app/view.mjs";
import { handoffLine } from "#frame/pages/renderers.mjs";
import { createReviewAlerts } from "#frame/sync/notifications.mjs";
import { connected, poll, remote } from "#frame/sync/rounds.mjs";

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
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) throw Error();
    sessions = (await response.json()).sessions || [];
  } catch {
    sessions = [];
  }
  renderSessions();
  void reviewAlerts.update(sessions);
}
function stateWords(entry) {
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
function renderSessions() {
  const others = sessions.filter((entry) => entry.id !== session.sessionId);
  const need = others.filter((entry) => entry.needsYou);
  const workingList = others.filter((entry) => !entry.needsYou);
  const mine = sessions.filter((entry) => entry.id === session.sessionId);
  // The number means attention: other sessions waiting on you. With none, the
  // bell stays as a plain way into the session list.
  $("bell").hidden = !others.length;
  $("bell-count").textContent = String(need.length);
  $("bell-count").hidden = !need.length;
  $("bell").classList.toggle("need", need.length > 0);
  $("bell").setAttribute(
    "aria-label",
    need.length
      ? `${plural(need.length, "session")} need you, ${plural(others.length, "other session")} live`
      : plural(others.length, "other session"),
  );
  document.title = (need.length ? `(${need.length}) ` : "") + plan.title;
  if (!others.length) toggleSidecar(false);
  sessionOrder = [...need, ...workingList, ...mine];
  const list = $("sidecar-list");
  list.replaceChildren();
  // Status first, two lines, nothing on the right: the sessions waiting on
  // you, a gap, then the rest, with this tab tinted.
  for (const [index, entry] of sessionOrder.entries()) {
    if (index === need.length && need.length && index < sessionOrder.length) {
      const gap = document.createElement("div");
      gap.className = "session-gap";
      list.append(gap);
    }
    const current = entry.id === session.sessionId;
    const row = document.createElement("button");
    row.type = "button";
    row.className =
      "session-row" +
      (entry.needsYou ? " need" : "") +
      (current ? " current" : "") +
      (entry.stage === "complete" ? " done" : "");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = entry.title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn session-dismiss";
    close.setAttribute("aria-label", `Close ${entry.title}`);
    close.textContent = "✕";
    const words = document.createElement("span");
    words.className = "words";
    const state = document.createElement("em");
    state.textContent = current ? "This tab" : stateWords(entry);
    words.append(state, ` · round ${entry.round} · ${ago(entry.updatedAt)}`);
    row.append(title, words);
    row.onclick = () => {
      if (current) toggleSidecar(false);
      else location.assign(entry.url);
    };
    // The row is a button, so the close control is its sibling rather than
    // a button inside one.
    const line = document.createElement("div");
    line.className = "session-line";
    line.append(row);
    if (!current) {
      line.append(close);
      close.onclick = async (event) => {
        event.stopPropagation();
        /* Two round trips, a dismiss and a poll, so the row says it is going
           before either starts. Without it a slow hub looks like a dead
           control. */
        close.disabled = true;
        line.dataset.closing = "true";
        try {
          const response = await fetch(`${entry.url}api/dismiss`, {
            method: "POST",
          });
          if (!response.ok) throw Error();
          await poll();
        } catch {
          delete line.dataset.closing;
          close.disabled = false;
          state.textContent = "Could not close";
        }
      };
    }
    list.append(line);
  }
}
export function toggleSidecar(open = !$("sessions-dialog").open) {
  if (open && $("bell").hidden) return;
  if (open) $("sessions-dialog").showModal();
  else if ($("sessions-dialog").open) $("sessions-dialog").close();
}
