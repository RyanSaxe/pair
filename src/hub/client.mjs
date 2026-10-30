import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxAdvice } from "../../adapters/codex/rules.mjs";
import { settings, version } from "../shared/settings.mjs";
import { read, requireValue } from "../shared/util.mjs";

const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function readRecord(config) {
  try {
    return await read(config.hubFile);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
// The interactive-plan hub answers /api/hub on the same port with the same
// fields, so hubInfo accepts only a reply whose app is "pair". A pair hub too
// old to send app is accepted when its pid matches the pid in the hub record.
export async function hubInfo(port, record) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/hub`, {
      signal: AbortSignal.timeout(1500),
    });
    const info = await response.json();
    return info.app === "pair" || (record && info.pid === record.pid)
      ? info
      : null;
  } catch {
    return null;
  }
}
// Two commands can reach one state directory by different paths, such as
// /tmp and /private/tmp on macOS, so the hub and the command each compare
// real paths.
export const ownStateDir = (config) =>
  fs.realpath(config.root).catch(() => path.resolve(config.root));
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
// The hub record can remain after its hub exits, and after the machine
// restarts, its pid can belong to another program. A pair hub's process
// command ends in cli.mjs hub. When ps fails or prints nothing, as it can in a sandbox,
// hubRunning treats any live process with the pid as the hub.
function hubRunning(pid) {
  if (!processAlive(pid)) return false;
  let command;
  try {
    command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return true;
  }
  return !command || /cli\.mjs hub$/.test(command);
}
export const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
async function waitFor(check, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(150);
  }
  return null;
}
// The hub answers on its port as soon as it listens, but it writes the hub
// record only after it loads every session on disk, and it cannot register a
// session before then. recordedHub therefore returns a hub only when the
// record contains its pid.
async function recordedHub(config) {
  const record = await readRecord(config);
  if (!record) return null;
  const info = await hubInfo(record.port, record);
  return info?.pid === record.pid ? info : null;
}
async function spawnHub(config) {
  await fs.mkdir(config.hubDir, { recursive: true, mode: 0o700 });
  const log = await fs.open(config.hubLog, "a", 0o600);
  const child = spawn(process.execPath, [cli, "hub"], {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    cwd: os.homedir(),
  });
  child.unref();
  await log.close();
  // When two commands spawn a hub at the same moment, only the hub that binds
  // the port writes the record, so spawnHub waits for the record and not for
  // its own child.
  const started = await waitFor(() => recordedHub(config), 15_000);
  requireValue(
    started,
    process.env.CODEX_SANDBOX
      ? `The hub did not start inside the sandbox, and its log is ${config.hubLog}. ${sandboxAdvice}`
      : `The hub did not start. Read ${config.hubLog} for the reason, then run pair check.`,
  );
  return started;
}
async function ensureHub(config = settings()) {
  const record = await readRecord(config);
  const port = record?.port || config.port;
  const stateDir = await ownStateDir(config);
  // A hub of another state directory cannot serve this one's sessions, so
  // ensureHub treats it as no hub. A hub too old to send stateDir counts as
  // this directory's hub.
  const ownHub = async (port) => {
    const info = await hubInfo(port, record);
    return info && (info.stateDir ?? stateDir) === stateDir ? info : null;
  };
  let info = port ? await ownHub(port) : null;
  if (!info && record && processAlive(record.pid))
    info = await waitFor(() => ownHub(record.port), 5000);
  // A hub of this state directory that answers before the record exists can
  // still be loading its sessions, so ensureHub waits for the record.
  if (info && !record) info = await waitFor(() => recordedHub(config), 15_000);
  if (info && info.version !== version) {
    if (info.live === 0) {
      process.kill(info.pid, "SIGTERM");
      await waitFor(async () => !processAlive(info.pid), 5000);
      info = null;
    } else
      console.error(
        `pair: the hub runs code version ${info.version}, and this command is version ${version}. The next pair start that finds no live session replaces the hub with one on its own code.`,
      );
  }
  if (!info) {
    // A running hub may not answer this command, as when the command runs in
    // a sandbox with no sockets. ensureHub then leaves the hub record in place
    // for the commands that can reach the hub.
    requireValue(
      !(record && hubRunning(record.pid)),
      process.env.CODEX_SANDBOX
        ? `The hub (pid ${record?.pid}) is running but does not answer on port ${record?.port} inside the sandbox. ${sandboxAdvice}`
        : `The hub (pid ${record?.pid}) is running but does not answer on port ${record?.port}. Run pair guide setup.md and follow it.`,
    );
    if (record) await fs.rm(config.hubFile, { force: true });
    if (config.port && (await portOpen(config.port))) {
      const other = await hubInfo(config.port);
      const occupant = other
        ? `A pair hub that this state directory has no record of (pid ${other.pid})`
        : "Another program";
      throw new Error(
        `${occupant} is using port ${config.port}. Set PAIR_HUB_PORT to a free port and run the command again.`,
      );
    }
    info = await spawnHub(config);
  }
  return { ...info, origin: `http://127.0.0.1:${info.port}` };
}
export async function attach(directory, config, wake, extra = {}) {
  const hub = await ensureHub(config);
  const record = await readRecord(config);
  requireValue(
    record && record.pid === hub.pid,
    `The hub (pid ${hub.pid}) left no record in ${config.hubFile}. Stop that process, then run pair start again.`,
  );
  const response = await fetch(hub.origin + "/agent/register", {
    method: "POST",
    headers: {
      authorization: `Bearer ${record.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionDir: directory, wake, ...extra }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  requireValue(response.ok, result.error || "Registration failed");
  return result;
}
