import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
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
// fields, so only a reply naming pair is pair's hub. A pair hub whose code
// predates that field is known instead by the pid in pair's own record.
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
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
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
// A hub answers on its port as soon as it listens, but writes its record
// only after it has loaded every session on disk, and it cannot register a
// session before then. So a hub counts as started once its record names it.
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
  // When another start spawned a hub at the same moment, the one that took
  // the port is the one the record names.
  const started = await waitFor(() => recordedHub(config), 15_000);
  requireValue(
    started,
    process.env.CODEX_SANDBOX
      ? `The hub did not start inside the sandbox (its log is ${config.hubLog}): ${sandboxAdvice}`
      : `The hub did not start; see ${config.hubLog}`,
  );
  return started;
}
async function ensureHub(config = settings()) {
  const record = await readRecord(config);
  const port = record?.port || config.port;
  let info = port ? await hubInfo(port, record) : null;
  if (!info && record && processAlive(record.pid))
    info = await waitFor(() => hubInfo(record.port, record), 5000);
  // A hub that answers with no record may still be loading its sessions.
  if (info && !record) info = await waitFor(() => recordedHub(config), 15_000);
  if (info && info.version !== version) {
    if (info.live === 0) {
      process.kill(info.pid, "SIGTERM");
      await waitFor(async () => !(await hubInfo(info.port, record)), 5000);
      info = null;
    } else
      console.error(
        `pair: the hub runs code version ${info.version}; this command is ${version}. It restarts when no session is live.`,
      );
  }
  if (!info) {
    if (record) await fs.rm(config.hubFile, { force: true });
    requireValue(
      !(config.port && (await portOpen(config.port))),
      `Port ${config.port} is in use by another program; set PAIR_HUB_PORT`,
    );
    info = await spawnHub(config);
  }
  return { ...info, origin: `http://127.0.0.1:${info.port}` };
}
export async function attach(directory, config, wake, start = false) {
  const hub = await ensureHub(config);
  const record = await readRecord(config);
  requireValue(
    record && record.pid === hub.pid,
    "The hub record is missing; stop the hub process and run `pair start` again",
  );
  const response = await fetch(hub.origin + "/agent/register", {
    method: "POST",
    headers: {
      authorization: `Bearer ${record.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionDir: directory, wake, start }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  requireValue(response.ok, result.error || "Registration failed");
  return result;
}
