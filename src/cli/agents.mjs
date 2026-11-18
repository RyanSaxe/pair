import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { adapters, detectWake, recognizes } from "../hub/wake.mjs";
import { ancestors, processTable } from "../shared/processes.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { atomic, requireValue } from "../shared/util.mjs";
import { listing, usageError } from "./arguments.mjs";

// pair's list of running agent sessions has one file per session, named for
// the entry's ID: the CLI and the session ID that the CLI keeps when the
// session resumes. Claude Code's wake target contains its inbox token, so only
// the user can open the directory, and atomic() writes each file with mode
// 600. Windows refuses a colon in a file name.
export const agentsDir = () => path.join(settings().root, "agents");

// A session runs while a process with the entry's process ID and start time
// runs, so a process that a restart gives the same ID does not count. An
// adapter whose process outlives its sessions, such as Codex's daemon, also
// asks about the session, and keeps the entry when nothing answers. An entry
// that pair cannot check, such as one from a CLI this pair has no adapter
// for, is "unknown", and pair skips and keeps it.
async function sessionState(entry, table) {
  const adapter = adapters[entry?.cli];
  const fields = [entry?.name, entry?.processStart, entry?.registeredAt];
  if (!adapter || !fields.every((field) => typeof field === "string"))
    return "unknown";
  const cli = table.get(entry.pid);
  if (cli?.start !== entry.processStart) return "ended";
  const running = adapter.running?.(entry.target, cli).catch(() => true);
  return (await (running ?? true)) ? "running" : "ended";
}

// readAgents deletes the entry of every session that has ended, and of every
// running one that replaced says a new session replaces, and returns the
// others that run, the most recently registered first.
export async function readAgents(
  table = processTable(),
  replaced = () => false,
) {
  const names = await fs.readdir(agentsDir()).catch(() => []);
  const files = names.filter((name) => name.endsWith(".json"));
  const entries = await Promise.all(
    files.map(async (name) => {
      const file = path.join(agentsDir(), name);
      const entry = await fs
        .readFile(file, "utf8")
        .then(JSON.parse)
        .catch(() => null);
      const state = await sessionState(entry, table).catch(() => "unknown");
      const ended =
        state === "ended" || (state === "running" && replaced(entry));
      if (ended) await fs.rm(file, { force: true });
      return state === "running" && !ended ? entry : null;
    }),
  );
  return entries
    .filter(Boolean)
    .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
}

// A default name is the folder's name and two hex characters from a hash of
// the session's ID, so the session gets the same name each time it registers,
// even after its CLI restarts, or the next value when a running session has
// that name.
function defaultName(directory, id, taken) {
  const base = path
    .basename(directory)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, "-");
  const [first] = crypto.createHash("sha256").update(id).digest();
  const names = Array.from(
    { length: 256 },
    (_, step) =>
      `${base}-${((first + step) % 256).toString(16).padStart(2, "0")}`,
  );
  return names.find((each) => !taken.has(each)) ?? names[0];
}

function currentBranch(cwd) {
  const { status, stdout } = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (status === 0 && stdout.trim()) || null;
}

// registerAgent writes the entry of the session that target names, and
// returns it with every running entry, itself first. The session runs in the
// ancestor in the adapter's pidVariable, or else in the nearest ancestor that
// the adapter recognizes. The pidVariable comes first because pi's subagent
// example starts pi without pair's extension loaded by -e, and that inner pi
// inherits the outer pi's variables and exits first. A subagent gets no entry,
// because pair reaches it through its parent, and for a sender whose parent
// is listed, registerAgent returns the parent's entry and the subagent's
// nickname instead of refusing.
export async function registerAgent(
  target,
  { name, table = processTable(), sender = false } = {},
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
  const chain = ancestors(table);
  const cli =
    chain.find(({ pid }) => pid === Number(process.env[adapter.pidVariable])) ??
    chain.find((ancestor) => recognizes(adapter, ancestor));
  requireValue(
    cli?.start,
    `pair found no ${adapter.name} process among the parents of this command, so it cannot tell when the session ends.`,
  );
  const id = `${target.harness}:${sessionId}`;
  const parent = await adapter.parentSession?.(target).catch(() => null);
  if (parent) {
    const parentId = `${target.harness}:${parent.sessionId}`;
    const running = await readAgents(table);
    const listed = running.find((each) => each.id === parentId);
    if (sender && listed && parent.nickname)
      return { entry: listed, subagent: parent.nickname, running };
    const via = listed?.name ?? parentId;
    throw new Error(
      `This ${adapter.name} session is a subagent, so pair lists only the session that started it. Reach it through that session as ${via}/${parent.nickname ?? `SUBAGENT, with the name ${via} gave it`}.`,
    );
  }
  // Claude Code's /clear and pi's /new start a new session in the same
  // process, so the new session's entry replaces that process's other entries,
  // unless the process serves several sessions.
  const running = await readAgents(
    table,
    (entry) =>
      entry.id !== id &&
      entry.cli === target.harness &&
      entry.pid === cli.pid &&
      entry.processStart === cli.start &&
      !adapter.sharesProcess?.(cli),
  );
  const others = running.filter((entry) => entry.id !== id);
  requireFreeName(others, name);
  const directory = process.cwd();
  const entry = {
    id,
    name:
      name ??
      running.find((each) => each.id === id)?.name ??
      defaultName(directory, id, new Set(others.map((each) => each.name))),
    cli: target.harness,
    directory,
    branch: currentBranch(directory),
    pid: cli.pid,
    processStart: cli.start,
    target,
    registeredAt: new Date().toISOString(),
  };
  await fs.mkdir(agentsDir(), { recursive: true, mode: 0o700 });
  await atomic(path.join(agentsDir(), `${id.replace(":", "-")}.json`), entry);
  return { entry, running: [entry, ...others] };
}

// findAgent returns the entry with the name or ID to, or the one entry whose
// ID starts with it, or null. It refuses a start that several IDs share.
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

// pair prints an ID cut to the shortest start, of at least eight characters
// of the session ID, that no other ID in ids has, because Codex's thread IDs
// start with the time.
function shortId(id, ids) {
  for (let end = id.indexOf(":") + 9; end < id.length; end++)
    if (
      !ids.some((other) => other !== id && other.startsWith(id.slice(0, end)))
    )
      return id.slice(0, end);
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

// requireFreeName refuses name when one of running, the running sessions'
// entries, has it.
export function requireFreeName(running, name) {
  const namesake = name && running.find((entry) => entry.name === name);
  requireValue(
    !namesake,
    namesake &&
      `The running session ${namesake.id} in ${shortPath(namesake.directory)} is named ${name}. Give another --name.`,
  );
}

export function requireName(command, name) {
  if (name !== undefined && !/^[\p{L}\p{N}][\p{L}\p{N}-]{0,63}$/u.test(name))
    throw usageError(
      command,
      "--name takes up to 64 letters, digits and hyphens, starting with a letter or digit.",
    );
}

// A CLI's start hook runs pair register --hook and writes its JSON to stdin.
// A failed hook must not stop the CLI from starting, so with --hook pair
// register prints its error and exits 0. pair register talks to no hub, so it
// reads the processes with PowerShell on Windows, where detectWake alone
// finds no ancestors.
export async function register(options) {
  requireNode();
  try {
    requireName("register", options.name);
    const stdin =
      options.hook && !process.stdin.isTTY ? await text(process.stdin) : "";
    const input = /^\s*\{/.test(stdin) ? JSON.parse(stdin) : null;
    const table = processTable();
    const tools = { ancestors: () => ancestors(table) };
    const { entry, running } = await registerAgent(
      detectWake(process.env, tools, input),
      { name: options.name, table },
    );
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

export async function agents() {
  requireNode();
  const running = await readAgents();
  const ids = running.map((entry) => entry.id);
  const rows = [
    ["NAME", "CLI", "DIRECTORY", "BRANCH", "ID"],
    ...running.map((entry) => [
      entry.name,
      adapters[entry.cli].name,
      shortPath(entry.directory),
      entry.branch ?? "-",
      shortId(entry.id, ids),
    ]),
  ];
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  const table = rows.map((row) =>
    row.map((cell, column) => cell.padEnd(widths[column] + 2)).join(""),
  );
  return {
    data: running.length
      ? table.map((line) => line.trimEnd()).join("\n")
      : "No registered agent session is running.",
    json: { agents: running.map(shown) },
  };
}
