const listedKinds = ["session", "waiting", "reply", "proposal"];
export const announced = (entry, event) =>
  listedKinds.includes(event.kind) &&
  !event.acknowledged &&
  (event.kind !== "waiting" || (entry.needsYou && entry.round === event.round));
export function eventTitle(event) {
  if (event.kind === "session") return `${event.agent} started a session`;
  if (event.kind === "waiting")
    return `Round ${event.round} is waiting for you`;
  if (event.kind === "proposal") return `Agent proposed ${event.name}`;
  return `Agent replied on ${event.name}`;
}
// A reply event from before events included the message index opens at
// the thread card.
export function eventTarget(event) {
  if (!event.thread) return event.target;
  const card = `thread-${event.thread}`;
  return event.message === undefined ? card : `${card}-${event.message}`;
}
// The r/ROUND path opens a round that the session has moved past as a
// read-only page.
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
const alertsFor = (entry) =>
  [
    wakeAlert(entry),
    ...(entry?.events || [])
      .filter((event) => announced(entry, event))
      .map((event) => eventAlert(entry, event)),
  ].filter(Boolean);

// Every session on the hub shares one notification permission and one
// enabled switch, because both belong to the hub's origin. Each alert's key
// is its session and round, or its event, so several tabs never announce
// the same thing. The frame never announces the session in the focused tab.
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
      /* When browser storage is unavailable, memory still contains the
         preference. */
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
          : "Alerts when a session starts, a round waits for you, an agent cannot be woken, replies or proposes work, in any session.";
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
