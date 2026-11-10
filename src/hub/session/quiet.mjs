import { accepts } from "../../shared/lifecycle.mjs";
import { proposalState } from "../../shared/proposal-state.mjs";

// Work is quiet when the agent has given no update on it for config.quietMs.
// A started page of the open round counts from its last note, or from its
// start. A proposal started here that is not done, with a part left or no
// parts yet, counts from the last change to its parts, or from its start.
// While any work is quiet, nextStep names it. When no pair command has run
// on the session for config.quietMs either, the hub wakes the holder, once
// for each page or card until it gets an update.

// When every part of a card is done or dropped, the only work left is the
// page that shows it, so the agent has no part to update.
const partsLeft = (card) =>
  !card.status?.parts?.length ||
  card.status.parts.some((part) => part.state === "left");
const count = (number, word) => `${number} ${word}${number === 1 ? "" : "s"}`;
const minutes = (ms) => Math.floor(ms / 60_000);

export function quietItems({ openRound, proposals }, now, ms) {
  const pages = (openRound?.pages || [])
    .filter((slot) => slot.state === "active")
    .map((slot) => ({
      kind: "page",
      id: slot.id,
      updated: Boolean(slot.note),
      at: slot.note?.at ?? slot.startedAt,
    }));
  const cards = proposals
    .filter((card) => proposalState(card) === "running" && partsLeft(card))
    .map((card) => ({
      kind: "proposal",
      id: card.id,
      updated: Boolean(card.status),
      at: card.status?.at ?? card.started.at,
    }));
  return [...pages, ...cards].filter((item) => now - Date.parse(item.at) > ms);
}

// A card with no update has no parts, and the hub refuses --status-done on a
// part the card does not list, so that card gets --status-left instead.
function updates(items, directory) {
  const cards = items.filter((item) => item.kind === "proposal");
  return [
    items.some((item) => item.kind === "page") &&
      `post a note on each page you are still working on with pair progress --session-dir ${directory} --page ID --note "…"`,
    cards.some((card) => card.updated) &&
      `mark each finished part with pair propose --session-dir ${directory} --id ID --status-done "…"`,
    cards.some((card) => !card.updated) &&
      `for each proposal with no parts yet, record its parts with pair propose --session-dir ${directory} --id ID --status-left "…", with one flag for each part`,
  ]
    .filter(Boolean)
    .join(", and ");
}

export function quietStep(items, now, ms, directory) {
  const since = {
    page: "last note",
    proposal: "parts last changed",
  };
  const named = items.map(
    (item) =>
      `${item.kind} ${item.id} (${item.updated ? since[item.kind] : "started"} ${count(minutes(now - Date.parse(item.at)), "minute")} ago)`,
  );
  const action = updates(items, directory);
  return `No update in ${count(minutes(ms), "minute")}: ${named.join(", ")}. ${action[0].toUpperCase()}${action.slice(1)}.`;
}

// A card started here with no part left needs only the page that shows its
// work and --done, so every next step names it until the agent marks it done.
export function finishedStep(proposals, directory) {
  const ids = proposals
    .filter((card) => proposalState(card) === "running" && !partsLeft(card))
    .map((card) => card.id);
  if (ids.length === 1)
    return `Proposal ${ids[0]} has no part left. After you publish the page that shows its work, run pair propose --session-dir ${directory} --id ${ids[0]} --done.`;
  if (ids.length)
    return `Proposals ${ids.slice(0, -1).join(", ")} and ${ids.at(-1)} have no part left. After you publish the page that shows each one's work, run pair propose --session-dir ${directory} --id ID --done for it.`;
  return null;
}

export function quietWake(items, ms, directory) {
  const named = items.map((item) => `${item.kind} ${item.id}`).join(", ");
  const cards = items.some((item) => item.kind === "proposal")
    ? " Leave a card that waits for the reviewer as it is."
    : "";
  return `pair: no pair command has run in session ${directory} for ${count(minutes(ms), "minute")}, and these have had no update in that time: ${named}. Between your current steps, ${updates(items, directory)}, then go on with your work.${cards}`;
}

export function quiet(session) {
  const { directory, config } = session;
  // woken contains a key for each quiet page or card already named in a
  // wake. The key includes the time of the last update, so a page or card
  // that gets an update can be in a later wake. The hub keeps woken in memory
  // only, so it counts the time since the holder's last command from no
  // earlier than when it loaded the session, and a restart does not wake the
  // holder at once about work that an earlier hub named.
  let woken = new Set();
  const loadedAt = Date.now();
  const idleSince = () =>
    Math.max(loadedAt, Date.parse(session.state.holder?.commandAt) || 0);
  const key = (item) => `${item.kind} ${item.id} ${item.at}`;
  const items = (now) =>
    !accepts(session.state, "wake")
      ? []
      : quietItems(
          {
            openRound: session.state.openRound,
            proposals: session.proposalItems(),
          },
          now,
          config.quietMs,
        );
  const finishedLine = () =>
    accepts(session.state, "wake")
      ? finishedStep(session.proposalItems(), directory)
      : null;
  function quietLine(now = Date.now()) {
    const quiet = items(now);
    return quiet.length
      ? quietStep(quiet, now, config.quietMs, directory)
      : null;
  }
  // The hub's timer calls wakeIfQuiet. It sends no second wake for a page
  // or card that was in an earlier wake and has had no update since, and a
  // wake for newly quiet work names all the quiet work.
  async function wakeIfQuiet(now = Date.now()) {
    const quiet = items(now);
    woken = new Set(quiet.map(key).filter((item) => woken.has(item)));
    if (!session.wake || !session.state.holder) return;
    if (now - idleSince() <= config.quietMs) return;
    if (quiet.every((item) => woken.has(key(item)))) return;
    for (const item of quiet) woken.add(key(item));
    await session.sendWake(quietWake(quiet, config.quietMs, directory));
  }
  return { finishedLine, quietLine, wakeIfQuiet };
}
