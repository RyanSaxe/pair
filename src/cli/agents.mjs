import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { adapters, detectWake, recognizes } from "../hub/wake.mjs";
import { ancestors, processTable } from "../shared/processes.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { atomic, requireValue } from "../shared/util.mjs";
import { usageError } from "./arguments.mjs";

// pair's list of running agent sessions has one file per session in this
// directory, named for the entry's ID, the CLI and the session ID that the
// CLI keeps when the session resumes. Claude Code's wake target contains its
// inbox token, so only the user can open the directory, and atomic() writes
// each file with mode 600. Windows refuses a colon in a file name.
const agentsDir = () => path.join(settings().root, "agents");
const entryFile = (id) =>
  path.join(agentsDir(), `${id.replace(":", "-")}.json`);

// A session runs while a process with the entry's process ID and start time
// runs, so a process that a restart gives the same ID does not count. An
// adapter whose process outlives its sessions, such as Codex's daemon, also
// asks the process about the session, and keeps the entry when it does not
// answer. sessionState returns "unknown" for an entry that pair cannot check,
// such as one from a CLI that this pair has no adapter for, and pair skips
// and keeps that entry.
async function sessionState(entry, table) {
  const adapter = adapters[entry?.cli];
  const { name, processStart, registeredAt } = entry ?? {};
  const fields = [name, processStart, registeredAt];
  if (!adapter || !fields.every((field) => typeof field === "string"))
    return "unknown";
  const cli = table.get(entry.pid);
  if (cli?.start !== entry.processStart) return "ended";
  if (!adapter.running) return "running";
  const running = await adapter.running(entry.target, cli).catch(() => true);
  return running ? "running" : "ended";
}

// readAgents deletes the entry of every session that has ended, and returns
// the running ones, the most recently registered first.
export async function readAgents(table = processTable()) {
  const names = await fs.readdir(agentsDir()).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const file = path.join(agentsDir(), name);
        const entry = await fs
          .readFile(file, "utf8")
          .then(JSON.parse)
          .catch(() => null);
        const state = await sessionState(entry, table).catch(() => "unknown");
        if (state === "ended") await fs.rm(file, { force: true });
        return state === "running" ? entry : null;
      }),
  );
  return entries
    .filter(Boolean)
    .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
}

// A default name is the folder's name, then two hex characters from a hash of
// the session's ID, so the session gets the same name each time it registers,
// even after its CLI restarts, or the next value when a running session has
// that name.
function defaultName(directory, id, taken) {
  const base = path
    .basename(directory)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, "-");
  const [first] = crypto.createHash("sha256").update(id).digest();
  for (let step = 0; step < 256; step++) {
    const name = `${base}-${((first + step) % 256).toString(16).padStart(2, "0")}`;
    if (!taken.has(name)) return name;
  }
  requireValue(
    false,
    `Running sessions have every name from ${base}-00 to ${base}-ff. Give this one a name with --name.`,
  );
}

// Git gives its hooks GIT_DIR and the other GIT_* variables, which would point
// git at the hook's repository, so currentBranch leaves them out.
function currentBranch(directory) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const { status, stdout } = spawnSync("git", ["branch", "--show-current"], {
    cwd: directory,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (status === 0 && stdout.trim()) || null;
}

// cliProcess returns the ancestor that runs the session: the process in the
// adapter's pidVariable, because a pi started inside pi without pair's
// extension inherits the outer pi's variables and exits before the outer pi,
// or else the nearest ancestor that the adapter recognizes.
function cliProcess(adapter, chain) {
  const owner = Number(process.env[adapter.pidVariable]);
  const cli =
    chain.find((ancestor) => ancestor.pid === owner) ??
    chain.find((ancestor) => recognizes(adapter, ancestor));
  requireValue(
    cli?.start,
    `pair found no ${adapter.name} process among the parents of this command, so it cannot tell when the session ends.`,
  );
  return cli;
}

// registerAgent writes the entry of the session that target names, and
// returns it with every running entry, itself first. A running session keeps
// its name unless name gives another. A subagent gets no entry, because pair
// reaches it through its parent.
export async function registerAgent(
  target,
  { name, table = processTable() } = {},
) {
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
  const cli = cliProcess(adapter, ancestors(table));
  const id = `${target.harness}:${sessionId}`;
  const running = await readAgents(table);
  const parent = await adapter.parentSession?.(target).catch(() => null);
  if (parent) {
    const parentId = `${target.harness}:${parent.sessionId}`;
    const through =
      running.find((entry) => entry.id === parentId)?.name ?? parentId;
    throw new Error(
      `This ${adapter.name} session is a subagent, so pair lists only the session that started it. Reach it through that session as ${parent.nickname ? `${through}/${parent.nickname}` : `${through}/SUBAGENT, with the name ${through} gave it`}.`,
    );
  }
  // Claude Code's /clear and pi's /new start a new session in the same
  // process, so the new session's entry replaces that process's other entries,
  // unless the process serves several sessions.
  const replaces = (entry) =>
    entry.cli === target.harness &&
    entry.pid === cli.pid &&
    entry.processStart === cli.start &&
    !adapter.sharesProcess?.(cli);
  const others = [];
  for (const entry of running) {
    if (entry.id === id) continue;
    if (replaces(entry)) await fs.rm(entryFile(entry.id), { force: true });
    else others.push(entry);
  }
  if (name !== undefined) {
    const namesake = others.find((entry) => entry.name === name);
    requireValue(
      !namesake,
      namesake &&
        `The running session ${namesake.id} in ${shortPath(namesake.directory)} is named ${name}. Give another --name.`,
    );
  }
  const directory = process.cwd();
  const taken = new Set(others.map((entry) => entry.name));
  const entry = {
    id,
    name:
      name ??
      running.find((each) => each.id === id)?.name ??
      defaultName(directory, id, taken),
    cli: target.harness,
    directory,
    branch: currentBranch(directory),
    pid: cli.pid,
    processStart: cli.start,
    target,
    registeredAt: new Date().toISOString(),
  };
  await fs.mkdir(agentsDir(), { recursive: true, mode: 0o700 });
  await atomic(entryFile(id), entry);
  return { entry, running: [entry, ...others] };
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

// The wake target contains Claude Code's inbox token, so pair prints every
// field of an entry but the target.
const shown = ({ target, ...entry }) => entry;

// A CLI writes its start hook's JSON to stdin and closes it, and an empty
// stdin such as /dev/null ends at once.
async function hookInput() {
  if (process.stdin.isTTY) return null;
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text || "null");
}

// A CLI's start hook runs pair register --hook, and a failed hook must not
// stop the CLI from starting, so with --hook pair register prints its error
// and exits 0. pair register talks to no hub, so it reads the processes with
// PowerShell on Windows, where detectWake alone finds no ancestors.
export async function register(options) {
  requireNode();
  if (
    options.name !== undefined &&
    !/^[\p{L}\p{N}][\p{L}\p{N}-]{0,63}$/u.test(options.name)
  )
    throw usageError(
      "register",
      "--name takes up to 64 letters, digits and hyphens, starting with a letter or digit.",
    );
  try {
    const input = options.hook ? await hookInput().catch(() => null) : null;
    const table = processTable();
    const tools = { ancestors: () => ancestors(table) };
    const target = detectWake(process.env, tools, input);
    const { entry, running } = await registerAgent(target, {
      name: options.name,
      table,
    });
    const id = shortId(
      entry.id,
      running.map((other) => other.id),
    );
    return {
      data: `Registered ${entry.name}, ${id}, in ${shortPath(entry.directory)}.`,
      json: shown(entry),
    };
  } catch (error) {
    if (!options.hook) throw error;
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
      row.map((cell, column) => cell.padEnd(widths[column] + 2)).join(""),
    )
    .map((line) => line.trimEnd())
    .join("\n");
}

export async function agents() {
  requireNode();
  const running = await readAgents();
  const ids = running.map((entry) => entry.id);
  const rows = running.map((entry) => [
    entry.name,
    adapters[entry.cli].name,
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
