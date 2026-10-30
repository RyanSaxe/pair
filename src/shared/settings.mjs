import crypto from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import net from "node:net";
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
// on the hub is live. The hub runs modules from across src/ and adapters/, and
// its builds read data files there too, so version hashes the path and contents
// of every file in src/ and adapters/. A new file needs no entry, and an edit
// to a frame file also restarts an idle hub.
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

// The hub refuses an agent command's request over this size, and pair publish
// checks a page against it before it sends the page.
export const agentRequestBytes = 20_000_000;

const stateHome = (env = process.env) =>
  env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
export const configRoot = (env = process.env) =>
  path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "pair");
const packageJson = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
// The release workflow sets the version with npm version, and a clone has
// 0.0.0-development.
export const packageVersion = packageJson.version;
// engines.node in package.json lists the oldest release that pair supports on
// each Node line. ^X.Y.Z covers line X alone, and >=X.Y.Z covers line X and
// every later line.
const floors = packageJson.engines.node.split("||").map((range) => {
  const match = /^\s*(\^|>=)((\d+)\.\d+\.\d+)\s*$/.exec(range);
  if (!match)
    throw new Error(
      `engines.node in package.json has a range pair cannot read: ${range.trim()}`,
    );
  return {
    release: match[2],
    line: Number(match[3]),
    later: match[1] === ">=",
  };
});
const parts = (release) => release.split(".").map(Number);
export function nodeFloor() {
  const line = parts(process.versions.node)[0];
  return floors.find(
    (floor) => floor.line === line || (floor.later && line > floor.line),
  );
}
export function requireNode() {
  const running = process.versions.node;
  const floor = nodeFloor();
  const supported = floors.map(({ release, line, later }) =>
    later ? `${release} or newer` : `${release} or newer in ${line}`,
  );
  requireValue(
    floor,
    `Node ${running} is not supported. Use Node ${new Intl.ListFormat("en", { type: "disjunction" }).format(supported)}.`,
  );
  const [have, need] = [parts(running), parts(floor.release)];
  const differs = have.findIndex((part, index) => part !== need[index]);
  requireValue(
    differs === -1 || have[differs] > need[differs],
    `Node ${running} is missing security fixes that Node released in ${floor.release}. Update Node to ${floor.release} or newer.`,
  );
}
// A hub listening on an unspecified address accepts connections from every
// network the machine is on. The BlockList matches every spelling of ::,
// including ::ffff:0.0.0.0.
const unspecified = new net.BlockList();
unspecified.addAddress("0.0.0.0", "ipv4");
unspecified.addAddress("::", "ipv6");
function isUnspecified(host) {
  const bare = host.replace(/^\[(.*)\]$/, "$1");
  if (net.isIPv6(bare)) return unspecified.check(bare, "ipv6");
  // Node's listen binds 0, 0.0 and 0x0 as 0.0.0.0, and new URL parses them
  // to 0.0.0.0.
  const url = `http://${bare}`;
  const address = URL.canParse(url) ? new URL(url).hostname : bare;
  return net.isIPv4(address) && unspecified.check(address, "ipv4");
}
export function settings(env = process.env) {
  const root = path.join(stateHome(env), "pair");
  const port =
    env.PAIR_HUB_PORT === undefined ? 4747 : Number(env.PAIR_HUB_PORT);
  requireValue(
    Number.isInteger(port) && port >= 0 && port <= 65535,
    "PAIR_HUB_PORT must be a port number",
  );
  requireValue(
    [undefined, "on", "off"].includes(env.PAIR_WAKE),
    "PAIR_WAKE must be on or off",
  );
  // The hub that serves the user's own sessions always wakes their agents, so
  // settings() allows PAIR_WAKE=off only for a hub with a state directory of
  // its own.
  requireValue(
    env.PAIR_WAKE !== "off" ||
      root !== path.join(os.homedir(), ".local", "state", "pair"),
    "Set PAIR_WAKE=off only for a scratch hub, and give that hub its own XDG_STATE_HOME.",
  );
  requireValue(
    !env.PAIR_HUB_HOST || !isUnspecified(env.PAIR_HUB_HOST),
    `PAIR_HUB_HOST is ${env.PAIR_HUB_HOST}, which would make the hub reachable from every network this machine is on. Set it to this machine's address on a network you trust.`,
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
    seenFile: path.join(root, "hub", "seen.json"),
    port,
    host: env.PAIR_HUB_HOST || null,
    idleMs: seconds("PAIR_HUB_IDLE_SECONDS", 900) * 1000,
    // tabWindowMs is how recently a pair tab on this machine must have polled
    // the session list for the hub to count the tab as open. A hidden tab polls
    // once a minute in Chrome 154, behind another tab or minimized, and in
    // Safari 17 behind another tab, and the window adds 30 s to that. Safari
    // stops polling from a minimized window, so the agent opens a second tab
    // beside it.
    tabWindowMs: 90_000,
    // quietMs is how long a page or a proposal that the agent works on goes
    // without an update before the hub counts it as quiet. quietCheckMs is how
    // often the hub checks whether to wake the holder about quiet work.
    quietMs: 600_000,
    quietCheckMs: 60_000,
    wake: env.PAIR_WAKE !== "off",
  };
}
