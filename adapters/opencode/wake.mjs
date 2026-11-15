import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { send } from "../listener.mjs";
import { parseTitle } from "./subagents.mjs";

// opencode 2 loads a plugin from a folder, server.js and tui.js in this one,
// and opencode 1 from a file, plugin.js.
const plugin = fileURLToPath(new URL("plugin.js", import.meta.url));
const folder = path.dirname(plugin);

// opencode reads the first of these files in its global config directory,
// and writes opencode.jsonc there when none exists.
function globalConfig(env = process.env) {
  const directory = path.join(
    env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "opencode",
  );
  const names = ["opencode.jsonc", "opencode.json", "config.json"];
  const found = names.find((name) => fs.existsSync(path.join(directory, name)));
  return path.join(directory, found ?? names[0]);
}

export const name = "opencode";

// pair's plugin sets PAIR_OPENCODE_SOCKET in the environment of each shell
// command that opencode runs. opencode 1's plugin also sets
// PAIR_OPENCODE_SESSION, and opencode 2 sets OPENCODE_SESSION_ID itself.
export const command = "opencode";
export const variables = ["PAIR_OPENCODE_SOCKET"];
// The plugin also sets the ID of opencode's process, so that pair finds the
// process whatever name it runs under, such as nixpkgs' .opencode-wrapped.
export const pidVariable = "PAIR_OPENCODE_PID";
export const unwakeable = `Ask the user to add "${folder}" to "plugin" in ${globalConfig()}, or "${plugin}" on opencode 1, and restart opencode with \`opencode --continue\`, then run this pair command again. This opencode session runs without pair's plugin, so the hub cannot wake it.`;

// One opencode process serves several sessions through one plugin socket, so
// the session ID identifies the agent, and a new session's registration
// leaves the other sessions of its process listed.
export const identity = (target) => target.session;
export const sharesProcess = () => true;

// launch returns the command line that starts a new session with a prompt,
// from opencode's documentation, with args, the caller's own flags for
// opencode.
export const launch = ({ prompt, args = [] }) => [
  command,
  ...args,
  "--prompt",
  prompt,
];

export function detect(env) {
  const session = env.PAIR_OPENCODE_SESSION ?? env.OPENCODE_SESSION_ID;
  if (!session) throw new Error(unwakeable);
  return { harness: "opencode", socket: env.PAIR_OPENCODE_SOCKET, session };
}

// A subagent's commands get the subagent's own session ID, so pair asks the
// plugin for the session's parent, and names the subagent by its task.
export async function parentSession({ socket, session }) {
  const { parentID, title } = await send(socket, { session, query: "session" });
  return parentID
    ? { sessionId: parentID, nickname: parseTitle(title).task }
    : null;
}

// opencode 2 runs pair's plugin in its background server, which keeps running
// after every opencode window exits, so that plugin answers whether a window
// has the session open. opencode 1's plugin runs in the window's own process,
// and answers that it does.
export async function running({ socket, session }) {
  return (await send(socket, { session, query: "session" })).open;
}

// The plugin prompts a subagent's own session, so pair message needs no tool
// for the parent to pass a message on with.
export const subagentTool = () => null;

// The plugin sends the line with promptAsync, and opencode adds it to the
// running request between its steps. With target.subagent, the plugin sends
// it to that subagent's session.
export async function wake({ socket, session, subagent }, line) {
  await send(socket, { session, text: line, ...(subagent && { subagent }) });
  return { via: "prompt", steerable: true };
}
