import { adapters, detectWake } from "../hub/wake.mjs";
import { ancestors } from "../shared/processes.mjs";
import { requireNode } from "../shared/settings.mjs";
import { usageError } from "./arguments.mjs";
import { readAgents, registerAgent, shortId, shortPath } from "./agents.mjs";

// --to takes NAME/SUBAGENT and an ID, which has a colon, so a name has neither.
const namePattern = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,63}$/u;

// The wake target contains Claude Code's inbox token, so pair prints every
// field of an entry but the target.
const shown = ({ target, ...entry }) => entry;

// A CLI writes its start hook's JSON to stdin and closes it. hookInput reads
// stdin to its end, which an empty stdin such as /dev/null reaches at once.
async function hookInput() {
  if (process.stdin.isTTY) return null;
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function registerSession(options) {
  requireNode();
  if (options.name !== undefined && !namePattern.test(options.name))
    throw usageError(
      "register",
      "--name takes up to 64 letters, digits and hyphens, starting with a letter or digit.",
    );
  const input = options.hook ? await hookInput() : null;
  // pair register talks to no hub, so it walks the ancestors as registering
  // does, with PowerShell on Windows, where ps finds none. A Codex start hook
  // has no CODEX_THREAD_ID, so only a codex ancestor chooses Codex for it.
  const target = detectWake(process.env, { ancestors }, input);
  const { entry, running } = await registerAgent(target, {
    name: options.name,
  });
  const id = shortId(
    entry.id,
    running.map((other) => other.id),
  );
  return {
    data: `Registered ${entry.name}, ${id}, in ${shortPath(entry.directory)}.`,
    json: shown(entry),
  };
}

// A CLI's start hook runs pair register --hook, and a failed hook must not
// stop the CLI from starting, so with --hook pair register prints its error
// and exits 0.
export async function register(options) {
  if (!options.hook) return registerSession(options);
  try {
    return await registerSession(options);
  } catch (error) {
    console.error(`pair: ${error.message}`);
    return null;
  }
}

function table(rows) {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] + 2),
        )
        .join(""),
    )
    .join("\n");
}

export async function agents() {
  requireNode();
  const { running } = await readAgents();
  const ids = running.map((entry) => entry.id);
  const rows = running.map((entry) => [
    entry.name,
    adapters[entry.cli]?.name ?? entry.cli,
    shortPath(entry.directory),
    entry.branch ?? "-",
    shortId(entry.id, ids),
  ]);
  return {
    data: rows.length
      ? table([["NAME", "CLI", "DIRECTORY", "BRANCH", "ID"], ...rows])
      : "No registered agent session is running.",
    json: { agents: running.map(shown) },
  };
}
