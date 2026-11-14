import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { adapters } from "../hub/wake.mjs";
import { ancestors, processStarts } from "../shared/processes.mjs";
import { settings } from "../shared/settings.mjs";
import { atomic, requireValue, withoutGitVariables } from "../shared/util.mjs";
import { listing } from "./arguments.mjs";

// pair's list of running agent sessions has one file per session in this
// directory. Claude Code's wake target contains its inbox token, so only the
// user can open the directory, and atomic() writes each file with mode 600.
const agentsDir = () => path.join(settings().root, "agents");

// An entry's ID is the CLI and the session ID that the CLI keeps when the
// session resumes. Windows refuses a colon in a file name, so the file name
// joins the two with a hyphen.
const entryFile = (cli, sessionId) =>
  path.join(agentsDir(), `${cli}-${sessionId}.json`);

async function readEntries() {
  let names;
  try {
    names = await fs.readdir(agentsDir());
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const file = path.join(agentsDir(), name);
        try {
          return { file, entry: JSON.parse(await fs.readFile(file, "utf8")) };
        } catch {
          return { file, entry: null };
        }
      }),
  );
}

// An entry's runningCheck says how pair checks that its session runs. Both
// checks need a process with the entry's pid and processStart, so a process
// ID that a new process reuses after a restart does not count. With
// "process", the CLI runs the session in that process. With "loaded", the
// process is a server that runs the sessions of several CLI processes, such as
// Codex's app-server daemon, and the session runs while the adapter's
// serverSession says the server has it loaded. pair keeps a "loaded" entry
// when the server does not answer, because its process is running.
async function isRunning(entry, starts) {
  if (
    typeof entry?.processStart !== "string" ||
    starts.get(entry.pid) !== entry.processStart
  )
    return false;
  if (entry.runningCheck === "process") return true;
  if (entry.runningCheck !== "loaded") return false;
  return adapters[entry.cli].serverSession(entry.target).then(
    ({ loaded }) => loaded,
    () => true,
  );
}

// readAgents deletes every entry that is not running, and returns the running
// ones, the most recently registered first, and the deleted ones as stopped.
export async function readAgents() {
  const found = await readEntries();
  const starts = processStarts(
    found.map(({ entry }) => entry?.pid).filter(Number.isInteger),
  );
  const checked = await Promise.all(
    found.map(async (item) => ({
      ...item,
      live: await isRunning(item.entry, starts),
    })),
  );
  const running = [];
  const stopped = [];
  for (const { file, entry, live } of checked) {
    if (live) {
      running.push(entry);
      continue;
    }
    await fs.rm(file, { force: true });
    if (entry) stopped.push(entry);
  }
  running.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
  return { running, stopped };
}

// A default name is the folder's name, lowercased with every character other
// than a letter, digit or hyphen turned into a hyphen, then a hyphen and two
// hex characters from a hash of the session's ID, so the session gets the
// same name each time it registers, even after its CLI restarts. When a
// running session has that name, defaultName takes the next value.
function defaultName(directory, id, taken) {
  const base = path
    .basename(directory)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, "-");
  const [first] = crypto.createHash("sha256").update(id).digest();
  for (let step = 0; step < 256; step++) {
    const hex = ((first + step) % 256).toString(16).padStart(2, "0");
    if (!taken.has(`${base}-${hex}`)) return `${base}-${hex}`;
  }
  requireValue(
    false,
    `Running sessions have every name from ${base}-00 to ${base}-ff. Give this one a name with --name.`,
  );
}

// currentBranch returns null outside a repository and on a detached HEAD.
function currentBranch(directory) {
  const { status, stdout } = spawnSync("git", ["branch", "--show-current"], {
    cwd: directory,
    env: withoutGitVariables(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (status === 0 && stdout.trim()) || null;
}

// cliProcess returns the nearest ancestor process that runs the adapter's
// command, and its start time, which the running check compares. Only
// registering looks it up, because on Windows the walk starts PowerShell.
function cliProcess(adapter) {
  const pid = ancestors().find(
    ({ command }) => command === adapter.command,
  )?.pid;
  requireValue(
    pid,
    `pair found no ${adapter.name} process among the parents of this command, so it cannot tell when the session ends.`,
  );
  const processStart = processStarts([pid]).get(pid);
  requireValue(
    processStart,
    `pair could not read the start time of ${adapter.name}'s process ${pid}.`,
  );
  return { pid, processStart };
}

// registerAgent writes the entry of the session that detectWake found, and
// returns it with every running entry, itself first. A running session keeps
// its name unless name gives another. A subagent with a session of its own,
// as in Codex, gets no entry, because pair reaches it through its parent.
export async function registerAgent(target, { name } = {}) {
  const adapter = adapters[target.harness];
  const sessionId = (adapter.sessionId ?? adapter.identity)(target);
  requireValue(
    sessionId,
    `${adapter.name} set no session ID for this command, so pair has no ID to list the session under.`,
  );
  requireValue(
    /^[\w.-]+$/.test(sessionId),
    `${adapter.name}'s session ID ${sessionId} has characters that pair cannot use in a file name.`,
  );
  const { pid, processStart } = cliProcess(adapter);
  const id = `${target.harness}:${sessionId}`;
  const { running } = await readAgents();
  const server = await adapter.serverSession?.(target).catch(() => null);
  if (server?.parent) {
    const parentId = `${target.harness}:${server.parent.sessionId}`;
    const parent = running.find((entry) => entry.id === parentId);
    throw new Error(
      `This ${adapter.name} session is a subagent, so pair lists only the session that started it. Reach it through that session as ${parent?.name ?? parentId}/${server.parent.nickname ?? sessionId}.`,
    );
  }
  const others = running.filter((entry) => entry.id !== id);
  const taken = new Set(others.map((entry) => entry.name));
  if (name !== undefined) {
    const namesake = others.find((entry) => entry.name === name);
    requireValue(
      !namesake,
      namesake &&
        `The running session ${namesake.id} in ${shortPath(namesake.directory)} is named ${name}. Give another --name.`,
    );
  }
  const own = running.find((entry) => entry.id === id);
  const directory = process.cwd();
  const entry = {
    id,
    name: name ?? own?.name ?? defaultName(directory, id, taken),
    cli: target.harness,
    directory,
    branch: currentBranch(directory),
    pid,
    processStart,
    runningCheck: server?.loaded ? "loaded" : "process",
    target,
    registeredAt: new Date().toISOString(),
  };
  await fs.mkdir(agentsDir(), { recursive: true, mode: 0o700 });
  await atomic(entryFile(target.harness, sessionId), entry);
  return { entry, running: [entry, ...others] };
}

// findAgent returns the entry that NAME|ID names: the entry with that name,
// the entry with that ID, or the one entry whose ID starts with it. It returns
// null when none matches, and refuses a start of an ID that more than one
// entry's ID has.
export function findAgent(entries, to) {
  const exact =
    entries.find((entry) => entry.name === to) ??
    entries.find((entry) => entry.id === to);
  if (exact) return exact;
  const matches = entries.filter((entry) => entry.id.startsWith(to));
  requireValue(
    matches.length < 2,
    `${to} is the start of the IDs of ${matches.length} sessions, ${listing(matches.map((entry) => `${entry.name} (${entry.id})`))}. Give the session's name or more of its ID.`,
  );
  return matches[0] ?? null;
}

// pair prints an entry's ID cut to the shortest start, of at least eight
// characters of the session ID, that no other entry's ID in ids has.
export function shortId(id, ids) {
  const sessionStart = id.indexOf(":") + 1;
  for (let end = sessionStart + 8; end < id.length; end++) {
    const prefix = id.slice(0, end);
    if (!ids.some((other) => other !== id && other.startsWith(prefix)))
      return prefix;
  }
  return id;
}

export function shortPath(directory) {
  const home = os.homedir();
  return directory === home || directory.startsWith(`${home}${path.sep}`)
    ? `~${directory.slice(home.length)}`
    : directory;
}
