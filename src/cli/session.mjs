import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { attach } from "../hub/client.mjs";
import { startHub } from "../hub/server.mjs";
import { detectWake, identify } from "../hub/wake.mjs";
import { guideCommand } from "../shared/guide.mjs";
import { pageData } from "../shared/records.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { exists, json, read, requireValue } from "../shared/util.mjs";

// fs.cp gives each copied directory its source's mode, and rm cannot empty
// a read-only directory, so the copy is made writable before it goes. A
// link is removed itself, never followed.
async function removeCopy(copy) {
  const stat = await fs.lstat(copy).catch(() => null);
  if (stat?.isDirectory()) {
    await fs.chmod(copy, 0o700).catch(() => {});
    const entries = await fs
      .readdir(copy, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries)
      if (entry.isDirectory()) await removeCopy(path.join(copy, entry.name));
  }
  await fs.rm(copy, { recursive: true, force: true });
}
// fs.cp points each copied link at the absolute path of its target. A link
// into the source, by the path given or its real path, is made relative
// again, so it resolves inside the copy after the source is gone. A link
// elsewhere keeps its target.
async function relinkInside(copy, roots, directory = copy) {
  const relink = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await relinkInside(copy, roots, file);
    if (!entry.isSymbolicLink()) continue;
    const target = await fs.readlink(file);
    const inside = roots
      .map((root) => path.relative(root, target))
      .find(
        (relative) =>
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative),
      );
    if (inside !== undefined) relink.push([file, inside]);
  }
  if (!relink.length) return;
  // fs.cp has already given the directory its source's mode, which may be
  // read-only, so it is writable only while its links change.
  const { mode } = await fs.stat(directory);
  await fs.chmod(directory, mode | 0o700);
  try {
    for (const [file, inside] of relink) {
      await fs.unlink(file);
      await fs.symlink(
        path.relative(directory, path.join(copy, inside)) || ".",
        file,
      );
    }
  } finally {
    await fs.chmod(directory, mode & 0o7777);
  }
}
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
  // A --source that is a link is copied as the directory it names.
  const given = path.resolve(source);
  const from = await fs.realpath(given);
  requireValue(
    (await fs.stat(from)).isDirectory(),
    `--source must be a directory, and ${source} is not`,
  );
  requireValue((await fs.readdir(from)).length, `--source ${source} is empty`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Making the target claims it, so two publishes of one page cannot both
  // copy. A kept source is never empty, so an empty target belongs to a
  // publish still copying, or to one that was stopped while it copied.
  try {
    await fs.mkdir(target);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const entries = await fs.readdir(target).catch(() => undefined);
    const stopped =
      entries?.length === 0
        ? " It is empty, so another publish of this page is still copying, or one was stopped while it copied. Run pair status: if the page is not published and no other publish is running, delete that directory and publish again."
        : "";
    throw new Error(
      `Source for round ${record.round} already exists at ${target}.${stopped}`,
    );
  }
  // The copy takes the target's place only once it is complete, so a copy
  // that fails leaves nothing for the retry to find.
  const partial = `${target}.partial-${crypto.randomUUID()}`;
  try {
    await fs.cp(from, partial, { recursive: true });
    await relinkInside(partial, [...new Set([from, given])]);
    // A read-only directory cannot be renamed on macOS.
    await fs.chmod(partial, ((await fs.stat(partial)).mode & 0o777) | 0o700);
    await fs.rename(partial, target);
  } catch (error) {
    await removeCopy(partial).catch(() => {});
    await fs.rmdir(target).catch(() => {});
    throw error;
  }
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
  "side-work": async ({ change, id, title, text, source, state, url }) => ({
    change,
    id,
    title,
    text,
    source,
    state,
    url,
  }),
  // Without --text or --file, reply marks the thread read and prints it.
  reply: async (options) => {
    requireValue(options.note, "reply takes --note ID");
    requireValue(
      !(options.text && options.file),
      "reply takes --text or --file, not both",
    );
    return {
      note: options.note,
      ...(options.text ? { text: options.text } : {}),
      ...(options.file
        ? { html: await fs.readFile(path.resolve(options.file), "utf8") }
        : {}),
    };
  },
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
  // pair side-work names its change first, and update then names the item.
  "side-work": {
    add: ["session-dir", "title", "text", "source"],
    update: ["session-dir", "state", "url"],
  },
  reply: ["session-dir", "note", "text", "file"],
};
const sideWorkUsage = `pair side-work takes add or update:
  pair side-work add --session-dir PATH --title TEXT --text TEXT --source TEXT
  pair side-work update ID --session-dir PATH --state working|pr|done [--url URL]`;
export const sessionCommands = Object.keys(commandOptions);
function argumentsFrom(argv) {
  const [command, ...rest] = argv;
  let known = commandOptions[command];
  let name = command;
  const options = {};
  if (command === "side-work") {
    options.change = rest.shift();
    requireValue(Object.hasOwn(known, options.change || ""), sideWorkUsage);
    known = known[options.change];
    name = `side-work ${options.change}`;
    if (options.change === "update") {
      requireValue(rest[0] && !rest[0].startsWith("--"), sideWorkUsage);
      options.id = rest.shift();
    }
  }
  for (let i = 0; i < rest.length; i++) {
    requireValue(rest[i].startsWith("--"), "Options must use --name value");
    const key = rest[i].slice(2);
    requireValue(
      known.includes(key),
      `--${key} is not an option of pair ${name}, which takes ${known.length ? known.map((option) => `--${option}`).join(", ") : "none"}`,
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
  // status only reads, and side-work may come from an agent the holder
  // briefed, so both run without an agent that can be woken, as from a plain
  // terminal, unless the session has to register with a new hub. status
  // still names the agent when there is one, because a hub that runs older
  // code answers status only for the holder.
  let wake = null;
  try {
    wake = detectWake();
  } catch (error) {
    if (!["status", "side-work"].includes(command)) throw error;
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
            : `Run ${guideCommand("round.md")} and follow its "Publish the round" section when the first round is ready.`),
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
  // Whether the hub may have acted on the request. It did when it accepted
  // it, and it may have when a request reached it but no whole answer came
  // back, or it failed inside. A refused connection never reached it, and a
  // refusal says it did not act.
  let mayHaveActed = false;
  // Connecting failed, so the request never left: refused, or blocked by a
  // sandbox or the network.
  const unreached = new Set([
    "ECONNREFUSED",
    "EPERM",
    "EACCES",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EADDRNOTAVAIL",
  ]);
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
      if (!unreached.has(error.cause?.code)) mayHaveActed = true;
      if (retry && error.name === "TypeError") return reattach();
      throw error;
    }
    let result;
    try {
      result = await response.json();
    } catch (error) {
      mayHaveActed = true;
      throw error;
    }
    if (retry && response.status === 404 && result.error === "Unknown session")
      return reattach();
    if (response.status >= 500) mayHaveActed = true;
    requireValue(
      response.ok,
      result.error || "Request failed",
      response.status,
    );
    mayHaveActed = true;
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
    // reply prints the thread and its instructions as text.
    console.log(
      command === "reply"
        ? result.text
        : json(command === "status" ? result.status : result),
    );
  } catch (error) {
    // Side work's source is text for the reviewer, not a kept directory.
    if (command !== "publish" || !action.source) throw error;
    // A source kept for a publish the hub refused would block the retry. A
    // published page's source is what the next round starts from, so while
    // the hub may have published this one the copy stays.
    if (!mayHaveActed) {
      await removeCopy(action.source);
      throw error;
    }
    // A timeout's error cannot take a longer message, so a new one does.
    throw new Error(
      `${error.message.replace(/(?<![.?!])$/, ".")} The hub may have published this page, so its source stays at ${action.source}. Run pair status: if the page is not published, delete that directory and publish again.`,
      { cause: error },
    );
  }
}
