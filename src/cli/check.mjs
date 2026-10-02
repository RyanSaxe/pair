import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  checkRefusal,
  codexReport,
  writeRules,
} from "../../adapters/codex/rules.mjs";
import { hubInfo, portOpen, readRecord } from "../hub/client.mjs";
import { oldestNode, requireNode, settings } from "../shared/settings.mjs";
import { listen } from "../shared/util.mjs";
import { rows } from "./output.mjs";

async function portReport(config) {
  const { port } = config;
  if (!(await portOpen(port))) return { port, state: "free" };
  const info = await hubInfo(port, await readRecord(config));
  return info
    ? { port, state: "hub", version: info.version, live: info.live }
    : { port, state: "busy" };
}
function hubLine(hub) {
  if (hub.state === "os-assigned")
    return "PAIR_HUB_PORT is 0, so the system picks a port when the hub starts";
  if (hub.state === "free") return `port ${hub.port} is free`;
  if (hub.state === "busy")
    return `port ${hub.port} is in use by another program`;
  const sessions = `${hub.live} live session${hub.live === 1 ? "" : "s"}`;
  return `port ${hub.port} runs a pair hub with ${sessions}, code ${hub.version}`;
}
const codexLine = (codex) =>
  `${codex.rules} ${codex.present ? "matches pair's rule" : "does not have pair's rule"}`;

// The checks pair start needs to pass, one line each. A check that fails
// outright refuses with its error, and a busy hub port adds a next step.
export async function check(options) {
  if (options["codex-rules"]) return writeRules();
  const codex = await codexReport();
  let directory;
  const server = http.createServer((_, response) => response.end("ready"));
  try {
    requireNode();
    // The hub writes under <state>/pair, so that is the directory to test.
    const base = options.args[0]
      ? path.resolve(options.args[0])
      : settings().root;
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
    const hub = config.port
      ? await portReport(config)
      : { port: config.port, state: "os-assigned" };
    const steps = [
      ...(hub.state === "busy"
        ? [
            `Set PAIR_HUB_PORT to a free port, because another program uses port ${hub.port}.`,
          ]
        : []),
    ];
    const lines = rows([
      [
        "node",
        `${process.versions.node}, and pair needs ${oldestNode} or newer`,
      ],
      ["storage", `${base}, writable`],
      ["loopback", "127.0.0.1 answers"],
      ["hub", hubLine(hub)],
      ["codex", codex && codexLine(codex)],
    ]);
    return {
      next: steps.join(" ") || undefined,
      data: steps.length ? lines : `Every check passed.\n\n${lines}`,
      json: {
        ready: true,
        node: process.versions.node,
        platform: process.platform,
        storage: base,
        hub,
        ...(codex ? { codex } : {}),
      },
    };
  } catch (error) {
    throw checkRefusal(error);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
