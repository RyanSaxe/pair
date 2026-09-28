import { ago } from "#frame/app/time.mjs";
import { $ } from "#frame/app/util.mjs";
import {
  base,
  currentAvailable,
  mode,
  plan,
  submittedRound,
} from "#frame/app/view.mjs";
import { chooseBlock } from "#frame/notes/blocks.mjs";
import { closeDrawer, displayedRound } from "#frame/pages/pages.mjs";
import { renderHistory } from "#frame/sync/activity-view.mjs";
import {
  openPast,
  remote,
  selectedTab,
  switchTab,
} from "#frame/sync/rounds.mjs";
import { toggleCenter } from "#frame/sync/center.mjs";

let renderedRounds = "";
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
    entries.map((entry) => [entry.round, entry.publishedAt]),
    displayedRound,
    mode,
    selectedTab,
    submittedRound,
  ]);
  if (signature === renderedRounds) return;
  renderedRounds = signature;
  const list = $("round-list");
  list.replaceChildren();
  for (const entry of entries) {
    const here = entry.round === displayedRound;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "dialog-row" + (here ? " current" : "");
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = here ? "✓" : "";
    const label = document.createElement("span");
    label.textContent = `Round ${entry.round}`;
    const status = document.createElement("small");
    status.textContent =
      entry.round === latest && latest !== submittedRound
        ? "Current"
        : "Feedback sent";
    label.append(document.createElement("br"), status);
    const time = document.createElement("small");
    time.textContent = entry.publishedAt ? ago(entry.publishedAt) : "";
    row.append(tick, label, time);
    // The live reader loads a past round into the left tab. A read-only
    // page has no tabs, so it opens the round's own page.
    row.onclick = () => {
      toggleRoundMenu(false);
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
    list.append(row);
  }
  // The plan's name lives in this dialog, because the frame shows it nowhere
  // else.
  $("round-plan").textContent = plan.title;
  const older = mode === "readonly" || selectedTab === "past";
  $("round").classList.toggle("older", older);
  renderHistory();
  $("round").setAttribute("aria-label", `Rounds, on round ${plan.round}`);
}
export function toggleRoundMenu(open = !$("round-dialog").open) {
  if (open) $("round-dialog").showModal();
  else if ($("round-dialog").open) $("round-dialog").close();
}
/* Escape, and every page change. A component with a popover of its own
   listens for plan:dismiss; the frame cannot reach inside one to close it. */
export function closeMenus() {
  chooseBlock(null);
  window.dispatchEvent(new CustomEvent("plan:dismiss"));
  closeDrawer();
  toggleRoundMenu(false);
  toggleCenter(false);
  if ($("sessions-dialog").open) $("sessions-dialog").close();
  if ($("settings-dialog").open) $("settings-dialog").close();
}
