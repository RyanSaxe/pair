import { ago } from "#frame/app/time.mjs";
import { $ } from "#frame/app/util.mjs";
import { pages, plan, session } from "#frame/app/view.mjs";
import { show } from "#frame/pages/pages.mjs";
import {
  eventHref,
  eventTarget,
  eventTitle,
} from "#frame/sync/notifications.mjs";
import { lineButton, redraw, sessionLine } from "#frame/sync/sessions.mjs";

/* The bell lists the agent replies and side-work pull requests of every
   session, newest first, from the last 50 events the hub keeps for each. A
   line leaves the list when you click it or its ✕, so the bell's number is
   the number of lines. Which events this browser removed stays in its
   storage for the hub, so every tab on the hub shares it and each browser
   keeps its own. A round published before the bell's list came keeps the
   notification center, which reads its own pair:center: keys, so this list
   uses a key of its own and leaves those alone. */

const listedKinds = ["reply", "side-work"];
const storageKey = "pair:bell:cleared";
// The removed IDs, kept here too when browser storage is unavailable. Null
// means this browser has never recorded anything.
let fallback = null;
function loadCleared() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) return new Set(JSON.parse(saved));
  } catch {
    /* Storage is blocked; the copy below is this tab's. */
  }
  return fallback && new Set(fallback);
}
function store(ids) {
  fallback = [...ids];
  try {
    localStorage.setItem(storageKey, JSON.stringify(fallback));
  } catch {
    /* Keep the copy above. */
  }
}
function clear(ids) {
  const cleared = loadCleared() || new Set();
  for (const id of ids) cleared.add(id);
  store(cleared);
  renderCenter(latest, false);
}
/* The removed IDs after a listing from the hub. A browser with no record
   removes every listed event, so the change starts with an empty bell.
   After that, an ID the hub no longer lists never returns, so it goes. */
export function settleCleared(listed, cleared) {
  if (!cleared) return new Set(listed);
  return new Set([...cleared].filter((id) => listed.includes(id)));
}

// The bell's lines: every listed reply and pull request not removed,
// newest first.
export function bellLines(sessions, cleared) {
  return sessions
    .flatMap((entry) =>
      (entry.events || [])
        .filter((event) => listedKinds.includes(event.kind))
        .map((event) => ({ ...event, entry })),
    )
    .filter((event) => !cleared?.has(event.id))
    .sort((a, b) => b.at.localeCompare(a.at));
}

let latest = [];
let lines = [];
// fromHub says the sessions came from the hub, so an ID they lack is gone
// for good.
export function renderCenter(sessions, fromHub) {
  latest = sessions;
  if (fromHub) {
    const before = loadCleared();
    const listed = sessions.flatMap((entry) =>
      (entry.events || []).map(({ id }) => id),
    );
    const after = settleCleared(listed, before);
    if (!before || after.size !== before.size) store(after);
  }
  lines = bellLines(sessions, loadCleared());
  const count = lines.length;
  const bell = $("bell");
  // The bell shows while the hub lists a live session, this tab's own
  // included, so n works with one session.
  bell.hidden = !sessions.length;
  bell.classList.toggle("need", count > 0);
  $("bell-count").hidden = !count;
  $("bell-count").textContent = String(count);
  bell.setAttribute(
    "aria-label",
    count ? `Notifications: ${count}` : "Notifications",
  );
  // The tab's title counts what needs you: the other sessions waiting and
  // the bell's lines.
  const waiting = sessions.filter(
    (entry) => entry.id !== session.sessionId && entry.needsYou,
  ).length;
  const titled = waiting + count;
  document.title = (titled ? `(${titled}) ` : "") + plan.title;
  if (bell.hidden) toggleCenter(false);
  drawCenter();
}

function drawCenter() {
  if (!isOpen()) return;
  $("center-clear-all").hidden = !lines.length;
  $("center-empty").hidden = Boolean(lines.length);
  redraw(
    $("center-list"),
    lines.map((event) =>
      sessionLine({
        key: `open:${event.id}`,
        title: eventTitle(event),
        words: `${event.entry.title} · ${ago(event.at)}`,
        tint: "",
        open: () => openEvent(event),
        icons: [
          lineButton(`clear:${event.id}`, "Clear", "✕", () =>
            clear([event.id]),
          ),
        ],
      }),
    ),
  );
}
// An event opens where it happened. In this tab's own round that is a page
// change, and anywhere else a new address. Opening it removes its line.
function openEvent(event) {
  clear([event.id]);
  toggleCenter(false);
  const here =
    event.entry.id === session.sessionId &&
    (!event.round || event.round === plan.round) &&
    pages.some((item) => item.id === event.page);
  if (here) show(event.page, eventTarget(event) || null);
  else location.assign(eventHref(event.entry, event));
}
const isOpen = () => $("center-pop").matches(":popover-open");
// The list opens under the bell, inside the window.
function placeCenter() {
  const box = $("bell").getBoundingClientRect();
  const width = Math.min(340, innerWidth - 16);
  $("center-pop").style.top = `${box.bottom + 6}px`;
  $("center-pop").style.left =
    `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
}
export function toggleCenter(open = !isOpen()) {
  if (!open) {
    if (isOpen()) $("center-pop").hidePopover();
    return;
  }
  if ($("bell").hidden || isOpen()) return;
  $("center-pop").showPopover();
}
export function installCenter() {
  $("center-pop").addEventListener("beforetoggle", (event) => {
    if (event.newState === "open") placeCenter();
  });
  $("center-pop").addEventListener("toggle", (event) => {
    $("bell").setAttribute("aria-expanded", String(event.newState === "open"));
    drawCenter();
  });
  $("center-clear-all").onclick = () => clear(lines.map(({ id }) => id));
  // Another tab on the hub removed a line.
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey) renderCenter(latest, false);
  });
}
