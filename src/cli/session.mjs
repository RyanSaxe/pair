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
function argumentsFrom(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    requireValue(rest[i].startsWith("--"), "Options must use --name value");
    const key = rest[i].slice(2);
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
      process.once(signal, () => hub.close().then(() => process.exit(0)));
    return;
  }
  let directory =
    options["session-dir"] && path.resolve(options["session-dir"]);
  const wake = detectWake();
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
  const connectionFile = path.join(directory, "connection.json");
  if (!(await exists(connectionFile))) await attach(directory, config, wake);
  let connection = await read(connectionFile);
  const checkConnection = () =>
    requireValue(
      /^http:\/\/127\.0\.0\.1:\d+$/.test(connection.origin),
      "Invalid connection origin",
    );
  checkConnection();
  // Every command names the agent that runs it, and the hub takes commands
  // only from the session's holder.
  const agent = identify(wake);
  async function request(data, retry = true) {
    const reattach = async () => {
      await attach(directory, config, wake);
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
            agent,
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
  const action = { action: command };
  if (command === "status")
    return console.log(json((await request(action)).status));
  if (command === "read") action.id = options.id;
  if (command === "ack") action.note = options.note;
  if (command === "pause") action.reason = options.reason;
  if (command === "progress") {
    requireValue(options.start, "progress takes --start ID");
    action.start = options.start.split("|");
  }
  let kept = null;
  if (command === "publish") {
    requireValue(options.file, "publish requires --file HTML");
    action.html = await fs.readFile(path.resolve(options.file), "utf8");
    if (options.pages)
      action.pages = (await read(path.resolve(options.pages))).pages;
    if (options.source) {
      kept = await keepSource(
        options["session-dir"],
        options.source,
        action.html,
      );
      action.source = kept;
    }
  }
  try {
    console.log(json(await request(action)));
  } catch (error) {
    if (kept) await fs.rm(kept, { recursive: true, force: true });
    throw error;
  }
}
