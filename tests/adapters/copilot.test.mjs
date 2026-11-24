import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as copilot from "../../adapters/copilot/wake.mjs";
import { wakeRunner } from "../../src/hub/wake.mjs";
import { processTable } from "../../src/shared/processes.mjs";
import { agentsScratch } from "../support/agents.mjs";
import { freePort, waitUntil } from "../support/hub.mjs";

// The hub wakes a Copilot session from a child process, through the SDK that
// ships inside Copilot CLI. This stand-in SDK appends each child's calls to the
// log as one line, and it refuses a send in each mode that PAIR_TEST_REFUSE
// names.
const sdkSource = (log) => `import fs from "node:fs";
const calls = [];
export const approveAll = () => ({ kind: "approved" });
export class CopilotClient {
  constructor(options) { calls.push(["client", options]); }
  async start() { calls.push(["start"]); }
  async getForegroundSessionId() { return "s-1"; }
  async getSessionMetadata(id) { return id === "s-1" ? { sessionId: id } : undefined; }
  async resumeSession(id, { onPermissionRequest }) {
    calls.push(["resume", id, onPermissionRequest === approveAll]);
    return {
      async send(message) {
        calls.push(["send", message]);
        if ((process.env.PAIR_TEST_REFUSE || "").split(" ").includes(message.mode))
          throw new Error(\`Copilot refused \${message.mode}\`);
      },
    };
  }
  async stop() {
    calls.push(["stop"]);
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(calls) + "\\n");
    return [];
  }
}
`;

test("a Copilot wake sends the line into the turn in progress, and enqueues it when Copilot refuses", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-copilot-"));
  t.after(() => {
    delete process.env.PAIR_TEST_REFUSE;
    return fs.rm(directory, { recursive: true, force: true });
  });
  const log = path.join(directory, "calls.json");
  const sdk = path.join(directory, "index.mjs");
  await fs.writeFile(sdk, sdkSource(log));
  const target = { harness: "copilot", sessionId: "s-1", port: 4321, sdk };
  const line = "pair: the reviewer submitted round 1 of session /s.";
  const child = (mode) => [
    [
      "client",
      {
        connection: { kind: "uri", url: "http://127.0.0.1:4321" },
        logLevel: "error",
      },
    ],
    ["start"],
    ["resume", "s-1", true],
    ["send", { prompt: line, mode }],
    ["stop"],
  ];
  const children = async () => {
    const lines = (await fs.readFile(log, "utf8")).trim().split("\n");
    await fs.rm(log);
    return lines.map((text) => JSON.parse(text));
  };

  assert.deepEqual(await wakeRunner(target, line), {
    via: "immediate",
    steerable: true,
  });
  assert.deepEqual(await children(), [child("immediate")]);

  process.env.PAIR_TEST_REFUSE = "immediate";
  assert.deepEqual(await wakeRunner(target, line), {
    via: "enqueue",
    steerable: false,
  });
  assert.deepEqual(await children(), [child("immediate"), child("enqueue")]);

  process.env.PAIR_TEST_REFUSE = "immediate enqueue";
  await assert.rejects(wakeRunner(target, line), /Copilot refused enqueue/);
  assert.deepEqual(await children(), [child("immediate"), child("enqueue")]);
});

// nixpkgs runs Copilot as node with Copilot's index.js, and Copilot's SDK is
// in the folder of that script.
test("pair recognizes a node process that runs Copilot's script, and finds the SDK beside it", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-copilot-"));
  const folder = path.join(directory, "github-copilot-cli");
  const sdk = path.join(folder, "copilot-sdk", "index.js");
  await fs.mkdir(path.dirname(sdk), { recursive: true });
  await fs.writeFile(sdk, "");
  const idle = "setInterval(() => {}, 1000);";
  await fs.writeFile(path.join(folder, "index.js"), idle);
  await fs.writeFile(path.join(directory, "index.js"), idle);
  const children = [];
  t.after(async () => {
    for (const child of children) child.kill();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  // pair reads each ancestor from the process table, which on Windows has its
  // command line.
  const node = async (script) => {
    const child = spawn(process.execPath, [script, "--ui-server"], {
      stdio: "ignore",
    });
    children.push(child);
    await once(child, "spawn");
    return processTable().get(child.pid);
  };
  const copilotNode = await node(path.join(folder, "index.js"));
  assert.equal(copilot.recognizes(copilotNode), true);
  assert.equal(
    copilot.recognizes(await node(path.join(directory, "index.js"))),
    false,
  );
  const target = copilot.detect(
    { COPILOT_AGENT_SESSION_ID: "s" },
    { ancestor: copilotNode, listeningPort: () => 4321 },
  );
  assert.equal(target.sdk, sdk);
});

// A Copilot subagent's commands get the subagent's own session ID, which the
// server has no session for.
test("a Copilot session that the server does not have is a subagent of the foreground session", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-copilot-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sdk = path.join(directory, "index.mjs");
  await fs.writeFile(sdk, sdkSource(path.join(directory, "calls.json")));
  const target = (sessionId) => ({
    harness: "copilot",
    sessionId,
    port: 4321,
    sdk,
  });
  assert.equal(await copilot.parentSession(target("s-1")), null);
  assert.deepEqual(await copilot.parentSession(target("sub-1")), {
    sessionId: "s-1",
  });
});

// Copilot started with --ui-server listens on 127.0.0.1. pair finds the port
// with lsof on macOS and Linux and with Get-NetTCPConnection on Windows, where
// pair start's own walk finds no ancestors and the adapter looks for Copilot's
// process itself.
test("pair start under Copilot CLI finds the port that Copilot's server listens on", async (t) => {
  const { home, list, folder, agent } = await agentsScratch(t);
  const cache = path.join(home, "cache");
  const platform = `${process.platform}-${process.arch}`;
  const sdk = path.join(cache, "pkg", platform, "copilot-sdk", "index.js");
  await fs.mkdir(path.dirname(sdk), { recursive: true });
  await fs.writeFile(sdk, "");
  const port = await freePort();
  const cli = await agent(await folder("app"), {
    harness: "copilot",
    env: {
      COPILOT_AGENT_SESSION_ID: "s-1",
      COPILOT_PKG_CACHE_HOME: cache,
      PAIR_TEST_LISTEN: String(port),
    },
  });
  const listening = () =>
    new Promise((resolve) =>
      net
        .connect(port, "127.0.0.1", function () {
          this.end();
          resolve(true);
        })
        .on("error", () => resolve(false)),
    );
  assert.ok(await waitUntil(listening));
  const started = await cli.run(["start", "--title", "Test"]);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stderr, "");
  const [file] = await fs.readdir(list);
  const { target } = JSON.parse(await fs.readFile(path.join(list, file)));
  assert.deepEqual(target, { harness: "copilot", sessionId: "s-1", port, sdk });
});
