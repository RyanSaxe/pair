import { ago } from "#frame/app/time.mjs";
import { $ } from "#frame/app/util.mjs";
import { base, plan, session } from "#frame/app/view.mjs";
import { pageIndicator, separator } from "#frame/pages/pages.mjs";
import { arrived, beginMove } from "#frame/pages/progress.mjs";
import { drawActivity, renderHistory } from "#frame/sync/activity-view.mjs";
import { remote, setRemote } from "#frame/sync/rounds.mjs";
import { pollSessions } from "#frame/sync/sessions.mjs";

/* Once the agent publishes Agreed, the hub serves the round at the same
   URL, and once the reviewer closes the session, the hub serves the page as
   closed. pollHome() reloads the page when a status shows either. */
async function pollHome() {
  try {
    const response = await fetch(`${base}/api/status`);
    if (!response.ok) throw Error();
    const status = await response.json();
    if (status.current || status.dismissedAt) {
      location.reload();
      return;
    }
    setRemote(status);
  } catch {
    // When the request fails, the next poll tries again.
    return;
  }
  $("home-agent").textContent = [
    remote.holder?.name,
    `started ${ago(remote.startedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  $("home-agent").hidden = false;
  renderHistory();
  $("agent-activity").hidden = false;
  drawActivity(true);
}
/* Nothing can open before the agent publishes Agreed, and there is no
   earlier round, so the rows, Last round and Rounds do nothing, and Current
   stays selected. */
function drawNavigation() {
  const tabs = document.createElement("div");
  tabs.className = "page-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Page versions");
  for (const [tab, label] of [
    ["past", "Last round"],
    ["current", "Current"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `${tab}-tab`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab === "current"));
    button.disabled = tab === "past";
    button.textContent = label;
    tabs.append(button);
  }
  const row = (title) => {
    const button = document.createElement("button");
    button.type = "button";
    const text = document.createElement("span");
    text.textContent = title;
    button.append(text);
    return button;
  };
  const agreed = row("Agreed so far");
  agreed.classList.add("pending");
  agreed.setAttribute("aria-label", "Agreed so far, queued");
  agreed.setAttribute("aria-disabled", "true");
  agreed.append(pageIndicator("queued"));
  const work = row("Work");
  const review = row("Review");
  work.disabled = review.disabled = true;
  const list = document.createElement("div");
  list.id = "page-list";
  list.append(agreed, separator(), work, separator(), review);
  $("navigation").append(tabs, list);
}
// The page load counts as a move, as it does on a round's first page, and
// the move ends after the first status draws the progress card.
export function startHome() {
  $("page-title").textContent = plan.title;
  $("round").disabled = true;
  if (session.closed) showClosed();
  else {
    drawNavigation();
    beginMove();
    void pollHome().finally(arrived);
    setInterval(pollHome, 1500);
  }
  void pollSessions();
  setInterval(pollSessions, 5000);
}
// The reload that shows a closed session counts as a move from the page
// before it, so showClosed() ends that move.
function showClosed() {
  $("home-agent").textContent = "The agent published no pages.";
  $("home-agent").hidden = false;
  $("submit").hidden = true;
  renderHistory();
  arrived();
}
