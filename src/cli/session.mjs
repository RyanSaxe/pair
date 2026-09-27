import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { attach } from "../hub/client.mjs";
import { startHub } from "../hub/server.mjs";
import { detectWake, identify } from "../hub/wake.mjs";
import { guideFile } from "../shared/guide.mjs";
import { pageData } from "../shared/records.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { exists, json, read, requireValue } from "../shared/util.mjs";

// The source a round was built from is kept beside its built file, so the
// next round starts from it after the temp directory is gone.
async function keepSource(sessionDir, source, html) {
  const record = pageData(html);
  const target = path.join(
    path.resolve(sessionDir),
    "src",
    record.round,
    record.page.id,
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.mkdir(target);
  } catch (error) {
    requireValue(
      error.code !== "EEXIST",
      `Source for round ${record.round} already exists at ${target}`,
    );
    throw error;
  }
  await fs.cp(path.resolve(source), target, { recursive: true });
  return target;
}
// The action each command sends the hub, from its options. start registers
// with the hub instead, and hub is the command start spawns.
const actions = {
  status: async () => ({}),
  read: async (options) => ({ id: options.id }),
  ack: async (options) => ({ note: options.note }),
  progress: async (options) => {
    requireValue(options.start, "progress takes --start ID");
    return { start: options.start.split("|") };
  },
  pause: async (options) => ({ reason: options.reason }),
  publish: async (options) => {
    requireValue(options.file, "publish requires --file HTML");
    const html = await fs.readFile(path.resolve(options.file), "utf8");
    const action = { html };
    if (options.pages)
      action.pages = (await read(path.resolve(options.pages))).pages;
    if (options.source)
      action.source = await keepSource(
        options["session-dir"],
        options.source,
        html,
      );
    return action;
  },
  complete: async () => ({}),
};
// The options each command takes. A misspelt option is refused, so a
// command never runs without a value it was given.
const commandOptions = {
  hub: [],
  start: ["session-dir"],
  status: ["session-dir"],
  read: ["session-dir", "id"],
  ack: ["session-dir", "note"],
  progress: ["session-dir", "start"],
  pause: ["session-dir", "reason"],
  publish: ["session-dir", "file", "pages", "source"],
  complete: ["session-dir"],
};
export const sessionCommands = Object.keys(commandOptions);
function argumentsFrom(argv) {
  const [command, ...rest] = argv;
  const known = commandOptions[command];
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    requireValue(rest[i].startsWith("--"), "Options must use --name value");
    const key = rest[i].slice(2);
    requireValue(
      known.includes(key),
      `--${key} is not an option of pair ${command}, which takes ${known.length ? known.map((name) => `--${name}`).join(", ") : "none"}`,
    );
    requireValue(
      rest[i + 1] && !rest[i + 1].startsWith("--"),
      `Missing value for --${key}`,
    );
    options[key] = rest[++i];
  }
  return { command, options };
}
export async function main(argv) {
  requireNode();
  const { command, options } = argumentsFrom(argv);
  const config = settings();
  if (command === "hub") {
    const hub = await startHub(config);
    for (const signal of ["SIGTERM", "SIGINT"])
      process.once(signal, () => hub.close());
    // The hub also closes itself once no session has been live for a while.
    await hub.closed;
    process.exit(0);
  }
  let directory =
    options["session-dir"] && path.resolve(options["session-dir"]);
  // status only reads, so it runs without an agent, as from a plain
  // terminal, unless the session has to register with a new hub. It still
  // names the agent when there is one, because a hub that runs older code
  // answers status only for the holder.
  let wake = null;
  try {
    wake = detectWake();
  } catch (error) {
    if (command !== "status") throw error;
  }
  const register = () => attach(directory, config, (wake ||= detectWake()));
  if (command === "start") {
    const resuming = Boolean(directory);
    directory ||= path.join(config.sessions, crypto.randomUUID());
    const started = await attach(directory, config, wake, true);
    return console.log(
      json({
        ...started,
        next:
          started.next ||
          (resuming
            ? `Run: pair ack --session-dir ${directory}`
            : `When the first round is ready, publish it as ${await guideFile("round.md", config.root)} describes, from "Publish the round".`),
      }),
    );
  }
  requireValue(directory, "Every operation requires --session-dir PATH");
  // Only pair start creates a session, so a mistyped path fails here instead
  // of starting a session outside sessions/ that no hub loads again.
  requireValue(
    await exists(path.join(directory, "status.json")),
    `No pair session at ${directory}. Check the path, or create a session with pair start.`,
  );
  const connectionFile = path.join(directory, "connection.json");
  if (!(await exists(connectionFile))) await register();
  let connection = await read(connectionFile);
  const checkConnection = () =>
    requireValue(
      /^http:\/\/127\.0\.0\.1:\d+$/.test(connection.origin),
      "Invalid connection origin",
    );
  checkConnection();
  async function request(data, retry = true) {
    const reattach = async () => {
      await register();
      connection = await read(connectionFile);
      checkConnection();
      return request(data, false);
    };
    let response;
    try {
      response = await fetch(
        `${connection.origin}/agent/${connection.sessionId}/action`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...data,
            sessionId: connection.sessionId,
            // The hub takes every command but status only from the
            // session's holder.
            agent: wake && identify(wake),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch (error) {
      if (retry && error.name === "TypeError") return reattach();
      throw error;
    }
    const result = await response.json();
    if (retry && response.status === 404 && result.error === "Unknown session")
      return reattach();
    requireValue(
      response.ok,
      result.error || "Request failed",
      response.status,
    );
    requireValue(
      (result.status?.sessionId || result.sessionId) === connection.sessionId,
      "Helper identity changed; resume the intended session",
      409,
    );
    return result;
  }
  const action = { action: command, ...(await actions[command](options)) };
  try {
    const result = await request(action);
    console.log(json(command === "status" ? result.status : result));
  } catch (error) {
    // A source kept for a publish the hub refused would block the retry.
    if (action.source)
      await fs.rm(action.source, { recursive: true, force: true });
    throw error;
  }
}
