import { listing, usageError } from "./arguments.mjs";
import { openSession } from "./session.mjs";
import { blockTag, tagText } from "./tags.mjs";

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
  return blockTag(
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
  );
}

function kindsOf(option) {
  if (option === undefined) return [];
  const kinds = option.split(",").filter(Boolean);
  const unknown = kinds.filter((kind) => !KINDS.includes(kind));
  if (unknown.length || !kinds.length) {
    throw usageError(
      "search",
      `--kind takes ${listing(KINDS)}, separated by commas.`,
    );
  }
  return kinds;
}

function limitOf(option) {
  const limit = option === undefined ? DEFAULT_LIMIT : Number(option);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw usageError("search", "--limit takes a number from 1 to 500.");
  }
  return limit;
}

function scopeText(options) {
  if (options["this-session"]) return "this session";
  if (options.closed) return "all sessions";
  return "live sessions";
}

function searchHeading(result, scope) {
  if (result.total) {
    const count = `${result.total} result${result.total === 1 ? "" : "s"} in ${scope}`;
    return `${count}, showing ${result.results.length}. ${WARNING}`;
  }
  if (result.wider?.filter === "closed") {
    return `No results in ${scope}. ${result.wider.total} in closed sessions, which --closed includes.`;
  }
  return `No results in ${scope}. Try fewer words, or other words.`;
}

async function runSearch(session, params) {
  let result = await session.search(params);
  for (let tries = 0; result.loading && tries < LOAD_TRIES; tries++) {
    await new Promise((done) => setTimeout(done, LOAD_WAIT_MS));
    result = await session.search(params);
  }
  return result;
}

export async function search(options) {
  const [query] = options.args;
  const kinds = kindsOf(options.kind);
  const limit = limitOf(options.limit);
  const session = await openSession(options, { anyAgent: true });
  const params = {
    q: query,
    limit: String(limit),
    ...(kinds.length ? { kinds: kinds.join(",") } : {}),
    ...(options["this-session"] ? { session: session.sessionId() } : {}),
    ...(options.closed ? { closed: "1" } : {}),
  };
  const result = await runSearch(session, params);
  const head = searchHeading(result, scopeText(options));
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
