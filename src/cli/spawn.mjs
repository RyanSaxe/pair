import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { adapters } from "../hub/wake.mjs";
import { runLaunch } from "../shared/launch.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { requireValue } from "../shared/util.mjs";
import { agentsDir, requireName, shortPath, shown } from "./agents.mjs";
import { usageError } from "./arguments.mjs";

const examples =
  "https://github.com/RyanSaxe/pair/blob/main/docs/guides/advanced-setup.md";
const waitMs = 30_000;
const pollMs = 250;

const entryFiles = () =>
  fs.readdir(agentsDir()).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

// pair spawn reads only the entry files that appeared after it ran the launch
// script, and never checks whether a process runs, so the wait starts no ps or
// PowerShell.
async function newEntry(before, matches) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    for (const file of await entryFiles()) {
      if (before.has(file) || !file.endsWith(".json")) continue;
      const entry = await fs
        .readFile(path.join(agentsDir(), file), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (entry && matches(entry)) return entry;
    }
    await sleep(pollMs);
  }
  return null;
}

export async function spawn(options) {
  requireNode();
  const [cli] = options.args;
  const [harness, adapter] =
    Object.entries(adapters).find(([, each]) => each.command === cli) ?? [];
  if (!adapter)
    throw usageError(
      "spawn",
      `pair spawn has no CLI ${cli}. Give claude, codex, copilot, pi or opencode.`,
    );
  requireName("spawn", options.name);
  if (options.prompt !== undefined && options.file !== undefined)
    throw usageError("spawn", "Give --prompt or --file, not both.");
  const { launchScript } = settings();
  requireValue(
    existsSync(launchScript),
    `pair spawn needs a launch script at ${shortPath(launchScript)}. pair runs it as ${path.basename(launchScript)} DIR COMMAND ARG…, and the script opens a terminal in DIR that runs the command. Example scripts are at ${examples}.`,
  );
  // A registered session's directory is the real path that its CLI runs in.
  const directory = await fs.realpath(options.dir ?? ".").catch(() => null);
  requireValue(
    directory && (await fs.stat(directory)).isDirectory(),
    `${options.dir} is not a folder.`,
  );
  const asked =
    options.file === undefined
      ? options.prompt
      : (await fs.readFile(options.file, "utf8")).trim();
  const register = options.name
    ? `pair register --name ${options.name}`
    : "pair register";
  const prompt = [`Run ${register} first.`, asked].filter(Boolean).join(" ");

  const before = new Set(await entryFiles());
  const command = adapter.launch({ name: options.name, prompt });
  await runLaunch(launchScript, directory, command);
  // Windows compares paths without case, as path.relative does there, so a
  // drive letter in the other case names the same folder.
  const entry = await newEntry(
    before,
    (each) =>
      each.cli === harness &&
      typeof each.directory === "string" &&
      path.relative(each.directory, directory) === "" &&
      (options.name === undefined || each.name === options.name),
  );
  const where = shortPath(directory);
  return entry
    ? {
        data: `Started ${entry.name} (${adapter.name}) in ${where}. Message it with: pair message --to ${entry.name} --text "…"`,
        json: { agent: shown(entry) },
      }
    : {
        data: `Started ${adapter.name} in ${where}. It appears in pair agents once it runs pair register.`,
        json: { agent: null },
      };
}
