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
    .filter(
      (card) => card.started?.where === "here" && !card.done && partsLeft(card),
    )
    .map((card) => ({
      kind: "proposal",
      id: card.id,
      updated: Boolean(card.status),
      at: card.status?.at ?? card.started.at,
    }));
  return [...pages, ...cards].filter((item) => now - Date.parse(item.at) > ms);
}

function updates(items, directory) {
  const kinds = new Set(items.map((item) => item.kind));
  return [
    kinds.has("page") &&
      `post a note on each page you are still working on with pair progress --session-dir ${directory} --page ID --note "…"`,
    kinds.has("proposal") &&
      `mark each finished part with pair propose --session-dir ${directory} --id ID --status-done "…"`,
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

export function quietWake(items, ms, directory) {
  const named = items.map((item) => `${item.kind} ${item.id}`).join(", ");
  const cards = items.some((item) => item.kind === "proposal")
    ? " Leave a card that waits for the reviewer as it is."
    : "";
  return `pair: no pair command has run in session ${directory} for ${count(minutes(ms), "minute")}, and these have had no update in that time: ${named}. Between your current steps, ${updates(items, directory)}, then go on with your work.${cards}`;
}

export function quiet(session) {
  const { directory, config } = session;
  // The hub does not save the time of the last command, so after a restart
  // the time since the last command counts from when the hub loaded the
  // session.
  let commandAt = Date.now();
  // woken contains a key for each quiet page or card already named in a
  // wake. The key includes the time of the last update, so a page or card
  // that gets an update can be in a later wake.
  let woken = new Set();
  const key = (item) => `${item.kind} ${item.id} ${item.at}`;
  const items = (now) =>
    session.state.stage === "complete" || session.state.paused
      ? []
      : quietItems(
          {
            openRound: session.state.openRound,
            proposals: session.proposalItems(),
          },
          now,
          config.quietMs,
        );
  function quietLine(now = Date.now()) {
    const quiet = items(now);
    return quiet.length
      ? quietStep(quiet, now, config.quietMs, directory)
      : null;
  }
  // act and hold call commandRan for every agent command, a subagent's
  // included, because a subagent runs its commands in its parent's
  // environment.
  const commandRan = () => {
    commandAt = Date.now();
  };
  // The hub's timer calls wakeIfQuiet. It sends no second wake for a page
  // or card that was in an earlier wake and has had no update since, and a
  // wake for newly quiet work names all the quiet work.
  async function wakeIfQuiet(now = Date.now()) {
    const quiet = items(now);
    woken = new Set(quiet.map(key).filter((item) => woken.has(item)));
    if (!session.wake || !session.state.holder) return;
    if (now - commandAt <= config.quietMs) return;
    if (quiet.every((item) => woken.has(key(item)))) return;
    for (const item of quiet) woken.add(key(item));
    await session.sendWake(quietWake(quiet, config.quietMs, directory));
  }
  return { quietLine, commandRan, wakeIfQuiet };
}
