// The events the bell lists and alerts for: a session that starts, a round
// that waits for the reviewer and an agent's reply. A waiting round's line
// lasts while that round waits.
const listedKinds = ["session", "waiting", "reply"];
export const announced = (entry, event) =>
  listedKinds.includes(event.kind) &&
  (event.kind !== "waiting" || (entry.needsYou && entry.round === event.round));
// What an event in a session says, in the bell and in its alert.
export function eventTitle(event) {
  if (event.kind === "session") return `${event.agent} started a session`;
  if (event.kind === "waiting")
    return `Round ${event.round} is waiting for you`;
  return `Agent replied on ${event.name}`;
}
// The element an event opens at: the reply itself, the thread card for a
// reply event from before replies named their message, or the block the
// event names.
export function eventTarget(event) {
  if (!event.thread) return event.target;
  const card = `thread-${event.thread}`;
  return event.message === undefined ? card : `${card}-${event.message}`;
}
// Where an event happened: its page and target, in the round it happened
// in. A round the session has moved on from opens read-only. An event on no
// page, a session's start or a waiting round, opens the session's URL.
export function eventHref(entry, event) {
  if (!event.page) return entry.url;
  const round =
    event.round && event.round !== entry.round
      ? `r/${encodeURIComponent(event.round)}`
      : "";
  const at = eventTarget(event);
  const target = at ? `?target=${encodeURIComponent(at)}` : "";
  return `${entry.url}${round}${target}#${encodeURIComponent(event.page)}`;
}
// A session whose agent the hub could not wake, once per round.
export function wakeAlert(entry) {
  if (!entry?.wakeFailed || !entry.id || !entry.round) return null;
  return {
    id: `wake:${entry.id}:${entry.round}`,
    sessionId: entry.id,
    title: "Could not wake the agent",
    body: entry.title || "",
    url: entry.url,
  };
}
export function eventAlert(entry, event) {
  return {
    id: `event:${event.id}`,
    sessionId: entry.id,
    title: eventTitle(event),
    body: entry.title || "",
    url: eventHref(entry, event),
    createdAt: event.at,
  };
}
// Alerts announce each line of the bell and an agent the hub could not
// wake.
const alertsFor = (entry) =>
  [
    wakeAlert(entry),
    ...(entry?.events || [])
      .filter((event) => announced(entry, event))
      .map((event) => eventAlert(entry, event)),
  ].filter(Boolean);

// One permission and one enabled switch for the hub origin. Alerts are keyed
// per session and round, or per event, so several tabs never announce the
// same thing, and the session shown in the focused tab is never announced.
export function createReviewAlerts({ window: host, button, sessionId, open }) {
  const prefix = "pair:alerts:";
  const memory = new Map();
  let latest = [],
    requesting = false,
    failed = false;
  const permission = () =>
    host.isSecureContext &&
    /^https?:$/.test(host.location.protocol) &&
    typeof host.Notification === "function"
      ? host.Notification.permission
      : "unavailable";
  const read = (key) => {
    try {
      return host.localStorage.getItem(prefix + key) || memory.get(key);
    } catch {
      return memory.get(key);
    }
  };
  const write = (key, value) => {
    memory.set(key, value);
    try {
      host.localStorage.setItem(prefix + key, value);
    } catch {
      /* Keep a usable preference when browser storage is unavailable. */
    }
  };
  const serialize = (action) =>
    host.navigator?.locks
      ? host.navigator.locks.request(prefix + "delivery", action)
      : action();
  const focused = () => {
    if (!sessionId) return;
    if (host.document.hasFocus()) write("focused", sessionId);
    else if (read("focused") === sessionId) write("focused", "");
  };
  function controls() {
    const state = permission();
    button.disabled =
      requesting || ["unavailable", "denied"].includes(state) || failed;
    button.textContent =
      state === "unavailable" || failed
        ? "Notifications unavailable"
        : state === "denied"
          ? "Notifications blocked"
          : read("enabled") === "yes" && state === "granted"
            ? "Disable notifications"
            : "Enable notifications";
    button.title =
      state === "denied"
        ? "Allow notifications in your browser's site settings."
        : failed
          ? "Notification delivery failed. Check browser and OS settings."
          : "Alerts when a session starts, a round waits for you, an agent cannot be woken, or an agent replies, in any session.";
  }
  function enable() {
    write("enabledAt", String(Date.now()));
    for (const alert of latest.flatMap(alertsFor)) write(alert.id, "handled");
    write("enabled", "yes");
  }
  async function update(entries = latest) {
    latest = Array.isArray(entries) ? entries : [];
    await serialize(() => {
      if (
        permission() === "granted" &&
        read("enabled") !== "no" &&
        !read("enabledAt")
      )
        enable();
      if (permission() !== "granted" || read("enabled") !== "yes" || failed)
        return;
      for (const alert of latest.flatMap(alertsFor)) {
        if (read(alert.id)) continue;
        if (
          read("focused") === alert.sessionId ||
          (alert.createdAt &&
            Date.parse(alert.createdAt) <= Number(read("enabledAt")))
        ) {
          write(alert.id, "handled");
          continue;
        }
        try {
          const item = new host.Notification(alert.title, {
            body: alert.body,
            tag: prefix + alert.id,
          });
          write(alert.id, "handled");
          item.onclick = () => {
            item.close();
            host.focus();
            open(alert.url);
          };
          item.onerror = () => {
            failed = true;
            controls();
          };
        } catch {
          failed = true;
        }
      }
    });
    controls();
  }
  button.onclick = async () => {
    if (read("enabled") === "yes" && permission() === "granted") {
      await serialize(() => write("enabled", "no"));
      controls();
      return;
    }
    requesting = true;
    controls();
    try {
      const result =
        permission() === "granted"
          ? "granted"
          : await host.Notification.requestPermission();
      if (result === "granted") await serialize(enable);
    } catch {
      failed = true;
    }
    requesting = false;
    controls();
  };
  host.addEventListener("storage", (event) => {
    if (event.key?.startsWith(prefix)) void update();
  });
  host.addEventListener("focus", focused);
  host.addEventListener("blur", focused);
  focused();
  controls();
  return { update };
}
