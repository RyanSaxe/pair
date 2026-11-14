import { adapters, detectWake } from "../hub/wake.mjs";
import { requireNode } from "../shared/settings.mjs";
import { usageError } from "./arguments.mjs";
import { readAgents, registerAgent, shortId, shortPath } from "./agents.mjs";

// --to takes NAME/SUBAGENT and an ID, which has a colon, so a name has neither.
const namePattern = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,63}$/u;

// The wake target contains Claude Code's inbox token, so pair prints every
// field of an entry but the target.
const shown = ({ target, ...entry }) => entry;

// A CLI writes its start hook's JSON to stdin and closes it. A program that
// leaves stdin open would make the read wait forever, so hookInput stops
// waiting after a second and registers without the JSON. It pauses stdin
// instead of destroying it, because Node aborts when it closes a stdin that
// is a file, such as /dev/null.
function hookInput() {
  const { stdin } = process;
  if (stdin.isTTY) return null;
  return new Promise((resolve) => {
    let text = "";
    const finish = () => {
      clearTimeout(timer);
      stdin.pause();
      stdin.unref?.();
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(null);
      }
    };
    const timer = setTimeout(finish, 1000);
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => (text += chunk));
    stdin.on("end", finish);
    stdin.on("error", finish);
  });
}

async function registerSession(options) {
  requireNode();
  if (options.name !== undefined && !namePattern.test(options.name))
    throw usageError(
      "register",
      "--name takes up to 64 letters, digits and hyphens, starting with a letter or digit.",
    );
  const input = options.hook ? await hookInput() : null;
  const detected = detectWake(process.env, undefined, input);
  const { entry, running } = await registerAgent(detected, {
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
