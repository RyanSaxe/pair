import { $ } from "#frame/app/util.mjs";
import { page, plan } from "#frame/app/view.mjs";
import { pageIndicator } from "#frame/pages/pages.mjs";
import { agentStopped, pendingLabel } from "#frame/sync/activity.mjs";
import { remote } from "#frame/sync/rounds.mjs";

// A page the agent has not published shows grey bars where its text will
// be, under a line that says what the agent is doing on it. show() draws the
// bars once, and each poll updates the line above them in place, because a
// newer note leaves the round's page list as it was.
export const pendingPage =
  '<div class="pending-page"><div class="pending-state"><span class="page-activity"></span><span><span class="pending-label"></span><small class="pending-age"></small></span></div><div class="pending-skeleton" aria-hidden="true"><i></i><i></i><i></i></div></div>';

export function updatePending() {
  const top = $("page-content").querySelector(":scope > .pending-page");
  if (!top) return;
  // Only the open round's pages carry the agent's notes and start times.
  const slot =
    !page.waiting && remote?.openRound?.round === plan.round
      ? remote.openRound.pages.find((item) => item.id === page.id)
      : null;
  const label = pendingLabel(
    {
      ...slot,
      state:
        page.status === "ready" ? "ready" : page.working ? "active" : "queued",
    },
    agentStopped(remote),
  );
  const mark = pageIndicator(label.mark);
  if (label.stopped) mark.classList.add("stopped");
  const old = top.querySelector(".page-activity");
  if (old.className !== mark.className) old.replaceWith(mark);
  const text = top.querySelector(".pending-label");
  if (text.textContent !== label.text) text.textContent = label.text;
  const age = top.querySelector(".pending-age");
  age.textContent = label.age || "";
  age.hidden = !label.age;
  age.classList.toggle("late", Boolean(label.late));
}
