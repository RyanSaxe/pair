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

// pair's plugin gives every shell command its wake socket and the ID of the
// session that runs the command.
export const command = "opencode";
export const variables = ["PAIR_OPENCODE_SOCKET", "PAIR_OPENCODE_SESSION"];
export const unwakeable = `this opencode session runs without pair's plugin, so it cannot be woken. Add "${plugin}" to "plugin" in ${globalConfig()}, restart opencode with \`opencode --continue\`, and run \`pair start\` again.`;

// One opencode process serves several sessions through one plugin socket.
export const identity = (target) => target.session;

export const detect = (env) => ({
  harness: "opencode",
  socket: env.PAIR_OPENCODE_SOCKET,
  session: env.PAIR_OPENCODE_SESSION,
});

export const wake = (target, line) =>
  send(target.socket, { session: target.session, text: line });
