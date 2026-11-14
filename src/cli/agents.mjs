import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { adapters } from "../hub/wake.mjs";
import { settings } from "../shared/settings.mjs";
import { atomic, requireValue } from "../shared/util.mjs";
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
const fileSafe = (sessionId) => /^[\w.-]+$/.test(sessionId);

// ps prints a start time in the time zone and locale of its environment, and
// a CLI's hook and its agent's commands can run with different ones, so
// processStarts runs ps in UTC and the C locale. It returns the start time of
// each process in pids that is running.
function processStarts(pids) {
  const starts = new Map();
  if (!pids.length) return starts;
  const { stdout } = spawnSync(
    "ps",
    ["-o", "pid=,lstart=", "-p", pids.join(",")],
    {
      encoding: "utf8",
      env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  for (const line of (stdout || "").split("\n")) {
    const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (match) starts.set(Number(match[1]), match[2]);
  }
  return starts;
}

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
// sessionLoaded says the server has it loaded. pair keeps a "loaded" entry
// when the server does not answer, because its process is running.
async function isRunning(entry, starts) {
  if (
    typeof entry?.processStart !== "string" ||
    starts.get(entry.pid) !== entry.processStart
  )
    return false;
  if (entry.runningCheck === "process") return true;
  if (entry.runningCheck !== "loaded") return false;
  return adapters[entry.cli].sessionLoaded(entry.target).catch(() => true);
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
// random hex characters that give a name no running session has.
function defaultName(directory, taken) {
  const base = path
    .basename(directory)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, "-");
  const free = Array.from(
    { length: 256 },
    (_, n) => `${base}-${n.toString(16).padStart(2, "0")}`,
  ).filter((name) => !taken.has(name));
  requireValue(
    free.length,
    `Running sessions have every name from ${base}-00 to ${base}-ff. Give this one a name with --name.`,
  );
  return free[crypto.randomInt(free.length)];
}

// Git reads GIT_DIR and GIT_WORK_TREE before the working directory, so
// currentBranch leaves every GIT_ variable out to read the folder's branch.
// It returns null outside a repository and on a detached HEAD.
function currentBranch(directory) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  const { status, stdout } = spawnSync("git", ["branch", "--show-current"], {
    cwd: directory,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (status === 0 && stdout.trim()) || null;
}

// cliStart returns the start time of the agent CLI's process, which the
// running check compares.
function cliStart(adapter, pid) {
  const passed = adapter.pidVariable
    ? ` and ${adapter.pidVariable} is not set`
    : "";
  requireValue(
    pid,
    `pair found no ${adapter.name} process among the parents of this command${passed}, so it cannot tell when the session ends.`,
  );
  const processStart = processStarts([pid]).get(pid);
  requireValue(
    processStart,
    `pair could not read the start time of ${adapter.name}'s process ${pid} with ps.`,
  );
  return processStart;
}

// registerAgent writes the entry of the session that detectWake found, and
// returns it with every running entry, itself first. The session keeps its
// name unless name gives another or a running session has taken it since.
export async function registerAgent({ target, pid }, { name } = {}) {
  const adapter = adapters[target.harness];
  const sessionId = adapter.sessionId(target);
  requireValue(
    sessionId,
    `${adapter.name} set no session ID for this command, so pair has no ID to list the session under.`,
  );
  requireValue(
    fileSafe(sessionId),
    `${adapter.name}'s session ID ${sessionId} has characters that pair cannot use in a file name.`,
  );
  const processStart = cliStart(adapter, pid);
  const id = `${target.harness}:${sessionId}`;
  const { running, stopped } = await readAgents();
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
  // A resumed session's entry has the process that exited, and the session
  // keeps that entry's name too.
  const own = [...running, ...stopped].find((entry) => entry.id === id);
  const kept = own && !taken.has(own.name) ? own.name : undefined;
  const directory = process.cwd();
  const loaded = await adapter.sessionLoaded?.(target).catch(() => false);
  const entry = {
    id,
    name: name ?? kept ?? defaultName(directory, taken),
    cli: target.harness,
    directory,
    branch: currentBranch(directory),
    pid,
    processStart,
    runningCheck: loaded ? "loaded" : "process",
    target,
    registeredAt: new Date().toISOString(),
  };
  await fs.mkdir(agentsDir(), { recursive: true, mode: 0o700 });
  await atomic(entryFile(target.harness, sessionId), entry);
  return { entry, running: [entry, ...others] };
}

// A session command registers its agent again when the agent's entry has
// another process or wake target, as after the CLI restarts, so the entry
// points at the running CLI. It leaves a session with no entry unregistered.
export async function refreshAgent({ target, pid }) {
  const sessionId = adapters[target.harness].sessionId(target);
  if (!sessionId || !pid || !fileSafe(sessionId)) return null;
  let entry;
  try {
    entry = JSON.parse(
      await fs.readFile(entryFile(target.harness, sessionId), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (entry.pid === pid && isDeepStrictEqual(entry.target, target)) return null;
  return registerAgent({ target, pid });
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
