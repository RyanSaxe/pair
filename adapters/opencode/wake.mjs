import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { send } from "../listener.mjs";

const plugin = fileURLToPath(new URL("plugin.js", import.meta.url));

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

// pair's plugin, plugin.js, sets these variables in the environment of each
// shell command that opencode runs.
export const command = "opencode";
export const variables = ["PAIR_OPENCODE_SOCKET", "PAIR_OPENCODE_SESSION"];
export const unwakeable = `Ask the user to add "${plugin}" to "plugin" in ${globalConfig()} and restart opencode with \`opencode --continue\`, then run this pair command again. This opencode session runs without pair's plugin, so the hub cannot wake it.`;

// One opencode process serves several sessions through one plugin socket, so
// the session ID identifies the agent, and a new session's registration
// leaves the other sessions of its process listed.
export const identity = (target) => target.session;
export const sharesProcess = () => true;

// launch returns the command line that starts a new session with a prompt,
// from opencode's documentation.
export const launch = ({ prompt }) => [command, "--prompt", prompt];

export const detect = (env) => ({
  harness: "opencode",
  socket: env.PAIR_OPENCODE_SOCKET,
  session: env.PAIR_OPENCODE_SESSION,
});

// A subagent's commands get the subagent's own session ID, so pair asks the
// plugin for the session's parent. pair names a subagent by its task, which
// opencode's task tool makes the title of the subagent's session, as "TASK
// (@AGENT subagent)".
export async function parentSession({ socket, session }) {
  const { parentID, title } = await send(socket, { session, query: "session" });
  const task = /^(.*) \(@.+ subagent\)$/.exec(title)?.[1] ?? title;
  return parentID ? { sessionId: parentID, nickname: task } : null;
}

// The plugin sends the line with promptAsync, and opencode adds it to the
// running request between its steps.
export async function wake(target, line) {
  await send(target.socket, { session: target.session, text: line });
  return { via: "prompt", steerable: true };
}
