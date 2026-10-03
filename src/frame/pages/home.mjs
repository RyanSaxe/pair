import { ago } from "#frame/app/time.mjs";
import { $ } from "#frame/app/util.mjs";
import { base, plan } from "#frame/app/view.mjs";
import { drawActivity } from "#frame/sync/activity-view.mjs";
import { remote, setRemote } from "#frame/sync/rounds.mjs";
import { pollSessions } from "#frame/sync/sessions.mjs";

/* The home view of a session with nothing published: its title, its agent
   and when it started, and the progress card while the agent prepares the
   first round. Once Agreed publishes, the hub serves the round at the same
   URL, so the view reloads when a status has a round. */
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
  $("agent-activity").hidden = false;
  drawActivity(true);
}
// Polls as a round does: its status every 1.5 s and the session list every
// 5 s.
export function startHome() {
  $("page-title").textContent = plan.title;
  void pollHome();
  void pollSessions();
  setInterval(pollHome, 1500);
  setInterval(pollSessions, 5000);
}
