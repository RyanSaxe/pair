import { ago } from "#frame/app/time.mjs";
import { $ } from "#frame/app/util.mjs";
import { base, plan } from "#frame/app/view.mjs";
import { pageIndicator, separator } from "#frame/pages/pages.mjs";
import { arrived, beginMove } from "#frame/pages/progress.mjs";
import { drawActivity, renderHistory } from "#frame/sync/activity-view.mjs";
import { remote, setRemote } from "#frame/sync/rounds.mjs";
import { pollSessions } from "#frame/sync/sessions.mjs";

/* The home view of a session with nothing published: a round's layout,
   with its title, its agent and when it started, and the progress card
   while the agent prepares the first round. Once Agreed publishes, the hub
   serves the round at the same URL, so the view reloads when a status has
   a round. */
async function pollHome() {
  try {
    const response = await fetch(`${base}/api/status`);
    if (!response.ok) throw Error();
    const status = await response.json();
    if (status.current) {
      location.reload();
      return;
    }
    setRemote(status);
  } catch {
    // The next poll tries again.
    return;
  }
  $("home-agent").textContent = [
    remote.holder?.name,
    `started ${ago(remote.startedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  $("home-agent").hidden = false;
  // A linked session names its parent under the header from its first view.
  renderHistory();
  $("agent-activity").hidden = false;
  drawActivity(true);
}
/* The sidebar lists what round 1 starts with: Agreed so far, queued as a
   round in progress lists a page not yet published, then Work and Review.
   None of them has anything to open before Agreed publishes, and there is
   no round before this one, so the rows, Last round and Rounds do nothing
   and Current stays selected. */
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
  $("round").disabled = true;
}
// Polls as a round does: its status every 1.5 s and the session list every
// 5 s. A page load is a move, as a round's first page is, and it ends once
// the first status has drawn the card.
export function startHome() {
  $("page-title").textContent = plan.title;
  drawNavigation();
  beginMove();
  void pollHome().finally(arrived);
  void pollSessions();
  setInterval(pollHome, 1500);
  setInterval(pollSessions, 5000);
}
