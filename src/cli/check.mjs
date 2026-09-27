import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  codexHome,
  rulesFile,
  rulesPresent,
  writeRules,
} from "../../adapters/codex/rules.mjs";
import { componentDirectories, userComponents } from "../build/components.mjs";
import { hubInfo, readRecord } from "../hub/client.mjs";
import { settings } from "../shared/settings.mjs";

const listen = (instance, port) =>
  new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(port, "127.0.0.1", resolve);
  });
async function portReport(port) {
  const busy = await new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  if (!busy) return { port, state: "free" };
  const info = await hubInfo(port, await readRecord(settings()));
  return info
    ? { port, state: "hub", version: info.version, live: info.live }
    : { port, state: "busy" };
}
/* The builder reads a second component root outside pair, so a user keeps
   components of their own across updates to pair. */
async function componentReport() {
  const directory = userComponents();
  const found = await componentDirectories();
  const yours = found.filter((entry) => entry.root === 1).map((e) => e.name);
  return {
    yours: directory,
    present: yours.length > 0,
    count: yours.length,
    ...(yours.length ? { names: yours } : {}),
    shipped: found.length - yours.length,
  };
}
export async function main([argument]) {
  if (argument === "--codex-rules") return writeRules();
  const codex =
    Boolean(process.env.CODEX_SANDBOX) ||
    (await fs.stat(codexHome).then(
      () => true,
      () => false,
    ));
  let directory;
  const server = http.createServer((_, response) => response.end("ready"));
  try {
    if (Number(process.versions.node.split(".")[0]) < 20)
      throw new Error("Node 20 or newer is required");
    const base = path.resolve(
      argument ||
        process.env.XDG_STATE_HOME ||
        path.join(os.homedir(), ".local", "state"),
    );
    await fs.mkdir(base, { recursive: true });
    directory = await fs.mkdtemp(path.join(base, "plan-capability-"));
    await fs.writeFile(path.join(directory, "draft"), "ready");
    await fs.rename(
      path.join(directory, "draft"),
      path.join(directory, "saved"),
    );
    if ((await fs.readFile(path.join(directory, "saved"), "utf8")) !== "ready")
      throw new Error("Session storage did not preserve the file");
    await listen(server, 0);
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
      signal: AbortSignal.timeout(5000),
    });
    if ((await response.text()) !== "ready")
      throw new Error("Loopback request failed");
    const port =
      process.env.PAIR_HUB_PORT === undefined
        ? 4747
        : Number(process.env.PAIR_HUB_PORT);
    console.log(
      JSON.stringify(
        {
          ready: true,
          node: process.versions.node,
          platform: process.platform,
          storage: base,
          components: await componentReport(),
          hub: port ? await portReport(port) : { port, state: "os-assigned" },
          ...(codex
            ? {
                codex: {
                  rules: rulesFile,
                  present: await rulesPresent(),
                  write: "pair check --codex-rules",
                },
              }
            : {}),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (error.code === "EPERM" && process.env.CODEX_SANDBOX)
      throw new Error(
        `the Codex sandbox blocks the hub's socket and its state directory. Run outside the sandbox (escalated): pair check --codex-rules, which writes ${rulesFile} so no later command asks. Then run the check again.`,
      );
    throw error;
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
