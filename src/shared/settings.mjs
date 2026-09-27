import crypto from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireValue } from "./util.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
// A command restarts a hub whose version differs from its own when no session
// on the hub is live. The hub runs modules from across src/ and the adapters,
// and the build it runs reads data files there too, so the version covers
// every file in src/ and adapters/, each with its path. A new file needs no
// entry, and an edit to a frame file also restarts an idle hub.
export const version = ["src", "adapters"]
  .flatMap((folder) => files(path.join(packageRoot, folder)))
  .map((file) => path.relative(packageRoot, file).split(path.sep).join("/"))
  .sort()
  .reduce(
    (hash, file) =>
      hash
        .update(`${file}\0`)
        .update(readFileSync(path.join(packageRoot, file))),
    crypto.createHash("sha256"),
  )
  .digest("hex")
  .slice(0, 12);

const stateHome = (env = process.env) =>
  env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
// The oldest Node pair supports, from engines.node in package.json.
const oldestNode = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
).engines.node.replace(">=", "");
export function requireNode() {
  const parts = (release) => release.split(".").map(Number);
  const [running, oldest] = [parts(process.versions.node), parts(oldestNode)];
  const differs = running.findIndex((part, index) => part !== oldest[index]);
  requireValue(
    differs === -1 || running[differs] > oldest[differs],
    `Node ${oldestNode} or newer is required`,
  );
}
export function settings(env = process.env) {
  const root = path.join(stateHome(env), "pair");
  const port =
    env.PAIR_HUB_PORT === undefined ? 4747 : Number(env.PAIR_HUB_PORT);
  requireValue(
    Number.isInteger(port) && port >= 0 && port <= 65535,
    "PAIR_HUB_PORT must be a port number",
  );
  const seconds = (name, fallback) => {
    if (env[name] === undefined) return fallback;
    const value = Number(env[name]);
    requireValue(
      Number.isFinite(value) && value >= 0,
      `${name} must be a number of seconds`,
    );
    return value;
  };
  return {
    root,
    sessions: path.join(root, "sessions"),
    hubDir: path.join(root, "hub"),
    hubFile: path.join(root, "hub", "hub.json"),
    hubLog: path.join(root, "hub", "hub.log"),
    port,
    host: env.PAIR_HUB_HOST || null,
    idleMs: seconds("PAIR_HUB_IDLE_SECONDS", 900) * 1000,
  };
}
