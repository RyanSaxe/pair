import crypto from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireValue } from "./util.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
function modules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return modules(file);
    return entry.name.endsWith(".mjs") ? [file] : [];
  });
}
// A command restarts a hub whose version differs from its own when no session
// on the hub is live. The version covers the hub's code: the modules in
// src/hub/ and src/shared/, and the adapters.
export const version = ["src/hub", "src/shared", "adapters"]
  .flatMap((folder) => modules(path.join(packageRoot, folder)))
  .map((file) => path.relative(packageRoot, file).split(path.sep).join("/"))
  .sort()
  .reduce(
    (hash, file) => hash.update(readFileSync(path.join(packageRoot, file))),
    crypto.createHash("sha256"),
  )
  .digest("hex")
  .slice(0, 12);

export const stateHome = (env = process.env) =>
  env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
export function requireNode() {
  requireValue(
    Number(process.versions.node.split(".")[0]) >= 20,
    "Node 20 or newer is required",
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
