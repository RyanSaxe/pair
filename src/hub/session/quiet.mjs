// Work the agent has given no update on for config.quietMs is quiet: a page
// of the open round it started, since its last note or else its start, and
// a proposal started here that is not done and has a part left or no parts
// yet, since its parts last changed or else its start. While any work is
// quiet, every next step names it. When no pair command has run on the
// session for as long either, the hub wakes the holder, once for each page
// or card until that page or card gets an update.

// A card whose parts are all done or dropped waits only for the page that
// shows the work, so the agent has no part left to update.
const partsLeft = (card) =>
  !card.status?.parts?.length ||
  card.status.parts.some((part) => part.state === "left");
const count = (number, word) => `${number} ${word}${number === 1 ? "" : "s"}`;
const minutes = (ms) => Math.floor(ms / 60_000);

// The quiet pages and cards at the time now, in milliseconds. Each has the
// time of its last update, at.
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

// The commands that update the kinds of work in items, joined into one
// clause.
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

// The line every next step ends with while items are quiet.
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

// The wake line when items are quiet and no pair command has run for ms.
export function quietWake(items, ms, directory) {
  const named = items.map((item) => `${item.kind} ${item.id}`).join(", ");
  const cards = items.some((item) => item.kind === "proposal")
    ? " Leave a card that waits for the reviewer as it is."
    : "";
  return `pair: no pair command has run in session ${directory} for ${count(minutes(ms), "minute")}, and these have had no update in that time: ${named}. Between your current steps, ${updates(items, directory)}, then go on with your work.${cards}`;
}

export function quiet(session) {
  const { directory, config } = session;
  // The hub keeps no record of commands across a restart, so a session it
  // loads counts from the hub's start.
  let commandAt = Date.now();
  // The quiet pages and cards already named in a wake, each with the time of
  // its last update, so a page or card that gets an update can be in a wake
  // again.
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
  // Any agent command on the session, a subagent's included, because a
  // subagent runs its commands in its parent's environment.
  const commandRan = () => {
    commandAt = Date.now();
  };
  // Runs from the hub's timer. The hub sends no second wake for a page or
  // card that was in an earlier wake and has had no update since, and a wake
  // for newly quiet work names it with the rest of the quiet work.
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
