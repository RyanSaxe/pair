// What an event in a session says, in the notification center and in its
// alert.
export function eventTitle(event) {
  if (event.kind === "page") return `${event.name} is ready`;
  if (event.kind === "reply") return `Agent replied on ${event.name}`;
  const pull = /\/pull\/(\d+)/.exec(event.url || "");
  return `Side work opened ${pull ? `pull request #${pull[1]}` : "a pull request"}`;
}
// Where an event happened: its page and block, in the round it happened in.
// A round the session has moved on from opens read-only.
export function eventHref(entry, event) {
  const round =
    event.round && event.round !== entry.round
      ? `r/${encodeURIComponent(event.round)}`
      : "";
  const target = event.target
    ? `?target=${encodeURIComponent(event.target)}`
    : "";
  return `${entry.url}${round}${target}#${encodeURIComponent(event.page)}`;
}
export function reviewAlert(entry) {
  if (!entry?.needsYou || !entry.id || !entry.round) return null;
  return {
    id: `round:${entry.id}:${entry.round}`,
    sessionId: entry.id,
    title: `Round ${entry.round} is ready${entry.offer ? " to accept" : ""}`,
    body: entry.title || "",
    url: entry.url,
    createdAt: entry.publishedAt,
  };
}
// A page of a round that waits for the reviewer is covered by the round's
// own alert, so the page that completed it is never announced as well.
export function eventAlert(entry, event) {
  return {
    id: `event:${event.id}`,
    sessionId: entry.id,
    title: eventTitle(event),
    body: entry.title || "",
    url: eventHref(entry, event),
    createdAt: event.at,
    covered:
      event.kind === "page" && entry.needsYou && event.round === entry.round,
  };
}
const alertsFor = (entry) =>
  [
    reviewAlert(entry),
    ...(entry?.events || []).map((event) => eventAlert(entry, event)),
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
          : "Alerts when a round or a page is ready, the agent replies, or side work opens a pull request, in any session.";
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
          alert.covered ||
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
