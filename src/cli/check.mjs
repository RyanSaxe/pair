import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  checkRefusal,
  codexReport,
  writeRules,
} from "../../adapters/codex/rules.mjs";
import { componentDirectories, userComponents } from "../build/components.mjs";
import { hubInfo, portOpen, readRecord } from "../hub/client.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { listen } from "../shared/util.mjs";

async function portReport(config) {
  const { port } = config;
  if (!(await portOpen(port))) return { port, state: "free" };
  const info = await hubInfo(port, await readRecord(config));
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
  const codex = await codexReport();
  let directory;
  const server = http.createServer((_, response) => response.end("ready"));
  try {
    requireNode();
    // The hub writes under <state>/pair, so that is the directory to test.
    const base = argument ? path.resolve(argument) : settings().root;
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
    const config = settings();
    console.log(
      JSON.stringify(
        {
          ready: true,
          node: process.versions.node,
          platform: process.platform,
          storage: base,
          components: await componentReport(),
          hub: config.port
            ? await portReport(config)
            : { port: config.port, state: "os-assigned" },
          ...(codex ? { codex } : {}),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    throw checkRefusal(error);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
