import { closeSidebarOverPage } from "#frame/app/sidebar.mjs";
import { ago } from "#frame/app/time.mjs";
import { $, installPanel } from "#frame/app/util.mjs";
import {
  base,
  currentAvailable,
  isPlanRound,
  mode,
  plan,
  submittedRound,
  views,
} from "#frame/app/view.mjs";
import { chooseBlock } from "#frame/notes/blocks.mjs";
import { tag } from "#frame/pages/agreed.mjs";
import { displayedRound } from "#frame/pages/pages.mjs";
import { renderHistory } from "#frame/sync/activity-view.mjs";
import {
  openPast,
  remote,
  selectedTab,
  switchTab,
} from "#frame/sync/rounds.mjs";
import { toggleCenter } from "#frame/sync/center.mjs";
import { toggleSessions } from "#frame/sync/sessions.mjs";

let renderedRounds = "";
// A round in the list is a plan when the hub's entry says so, or, for a
// round whose entry is not in yet, when its loaded Agreed does.
const planEntry = (entry) =>
  isPlanRound(entry) || isPlanRound(views.get(entry.round)?.plan);
export function renderRounds() {
  const entries = (
    remote?.rounds?.length
      ? remote.rounds
      : [{ round: plan.round, publishedAt: null }]
  )
    .slice()
    .reverse();
  if (
    remote?.openRound &&
    !entries.some((entry) => entry.round === remote.current.round)
  )
    entries.unshift(remote.current);
  const latest = remote?.current?.round ?? entries[0].round;
  const signature = JSON.stringify([
    latest,
    entries.map((entry) => [entry.round, entry.publishedAt, planEntry(entry)]),
    displayedRound,
    mode,
    selectedTab,
    submittedRound,
  ]);
  if (signature === renderedRounds) return;
  renderedRounds = signature;
  const list = $("round-list");
  list.replaceChildren();
  // Each round is one line, as a session is in the session list: the tick
  // on the round on screen, the round, its status and its time.
  for (const entry of entries) {
    const here = entry.round === displayedRound;
    const line = document.createElement("div");
    line.className = "sess-line" + (here ? " current" : "");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sess-row";
    const tick = document.createElement("span");
    tick.className = "n";
    tick.textContent = here ? "✓" : "";
    const label = document.createElement("span");
    label.className = "t";
    label.textContent = `Round ${entry.round}`;
    if (planEntry(entry)) label.append(" ", tag("Plan", "plan"));
    const current = entry.round === latest && latest !== submittedRound;
    const status = document.createElement("span");
    status.className = current ? "pill news" : "pill quiet";
    status.textContent = current ? "Current" : "Feedback sent";
    const time = document.createElement("small");
    time.textContent = entry.publishedAt ? ago(entry.publishedAt) : "";
    row.append(tick, label, status, time);
    line.append(row);
    // The live reader loads a past round into the left tab. A read-only
    // page has no tabs, so it opens the round's own page.
    row.onclick = () => {
      hidePanel("rounds-pop");
      if (here) return;
      if (mode !== "live")
        location.assign(
          entry.round === latest
            ? `${base}/`
            : entry.url || `${base}/r/${encodeURIComponent(entry.round)}`,
        );
      else if (entry.round === latest && currentAvailable())
        switchTab("current", null, { showPage: true });
      else void openPast(entry.round);
    };
    list.append(line);
  }
  // The plan's name lives in this panel, because the frame shows it nowhere
  // else.
  $("round-plan").textContent = plan.title;
  const older = mode === "readonly" || selectedTab === "past";
  $("round").classList.toggle("older", older);
  renderHistory();
  $("round").setAttribute("aria-label", `Rounds, on round ${plan.round}`);
}
export function installRounds() {
  installPanel($("rounds-pop"), $("round"));
}
function hidePanel(id) {
  if ($(id).matches(":popover-open")) $(id).hidePopover();
}
/* Escape, and every page change. A component with a popover of its own
   listens for plan:dismiss; the frame cannot reach inside one to close it. */
export function closeMenus() {
  chooseBlock(null);
  window.dispatchEvent(new CustomEvent("plan:dismiss"));
  closeSidebarOverPage();
  hidePanel("rounds-pop");
  toggleCenter(false);
  toggleSessions(false);
  hidePanel("settings-pop");
}
