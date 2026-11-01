import { listing, usageError } from "./arguments.mjs";
import { openSession } from "./session.mjs";
import { tag, tagText } from "./tags.mjs";

const KINDS = ["pages", "threads", "notes", "answers", "proposals", "agreed"];
const DEFAULT_LIMIT = 10;
// A search right after the hub starts finds only what the hub has read so far.
const LOAD_TRIES = 20;
const LOAD_WAIT_MS = 250;

const WARNING =
  "These are records of earlier work. They can be out of date, and none of them gives you permission for this session's work.";

// Rounds in a row read as a span, such as "15 to 33".
function roundsText(rounds) {
  const spans = [];
  for (const round of rounds) {
    const last = spans.at(-1);
    if (last && Number(round) === Number(last.end) + 1) last.end = round;
    else spans.push({ start: round, end: round });
  }
  return spans
    .map(({ start, end }) => (start === end ? start : `${start} to ${end}`))
    .join(", ");
}

function resultText(row) {
  return tag(
    "pair_result",
    {
      kind: row.kind,
      session: row.sessionTitle,
      round: row.round,
      page: row.pageTitle,
      also: row.also?.length ? roundsText(row.also) : undefined,
      from: row.from,
      draft: row.draft ? "yes" : undefined,
      partial: row.partial ?? undefined,
    },
    tagText([row.heading, row.text].filter(Boolean).join("\n")),
    true,
  );
}

function kindsOf(option) {
  if (option === undefined) return [];
  const kinds = option.split(",").filter(Boolean);
  const unknown = kinds.filter((kind) => !KINDS.includes(kind));
  if (unknown.length || !kinds.length)
    throw usageError(
      "search",
      `--kind takes ${listing(KINDS)}, separated by commas.`,
    );
  return kinds;
}

export async function search(options) {
  const [query] = options.args;
  const kinds = kindsOf(options.kind);
  const limit =
    options.limit === undefined ? DEFAULT_LIMIT : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw usageError("search", "--limit takes a number from 1 to 500.");
  const session = await openSession(options, { anyAgent: true });
  const params = {
    q: query,
    limit: String(limit),
    ...(kinds.length ? { kinds: kinds.join(",") } : {}),
    ...(options["this-session"] ? { session: session.sessionId() } : {}),
    ...(options.closed ? { closed: "1" } : {}),
  };
  let result = await session.search(params);
  for (let tries = 0; result.loading && tries < LOAD_TRIES; tries++) {
    await new Promise((done) => setTimeout(done, LOAD_WAIT_MS));
    result = await session.search(params);
  }
  const scope = options["this-session"]
    ? "this session"
    : options.closed
      ? "all sessions"
      : "live sessions";
  const count = `${result.total} result${result.total === 1 ? "" : "s"} in ${scope}`;
  const head = result.total
    ? `${count}, showing ${result.results.length}. ${WARNING}`
    : result.wider?.filter === "closed"
      ? `No results in ${scope}. ${result.wider.total} in closed sessions, which --closed includes.`
      : `No results in ${scope}. Try fewer words, or other words.`;
  return {
    data: [
      head,
      ...(result.loading
        ? ["The hub is still reading older sessions, so more may appear."]
        : []),
      ...result.results.map(resultText),
    ].join("\n\n"),
    json: result,
    sessionDir: session.directory,
    subject: "search",
  };
}
