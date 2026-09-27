import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { wakeRunner } from "../../src/hub/wake.mjs";

// The hub wakes a Copilot session in a child process, through the SDK that
// ships inside Copilot CLI. This stand-in SDK records each call pair makes.
const sdkSource = (log) => `import fs from "node:fs";
const calls = [];
export const approveAll = () => ({ kind: "approved" });
export class CopilotClient {
  constructor(options) { calls.push(["client", options]); }
  async start() { calls.push(["start"]); }
  async resumeSession(id, { onPermissionRequest }) {
    calls.push(["resume", id, onPermissionRequest === approveAll]);
    return {
      async send(message) {
        calls.push(["send", message]);
        if (process.env.PAIR_TEST_FAIL) throw new Error("session gone");
      },
    };
  }
  async stop() {
    calls.push(["stop"]);
    fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(calls));
  }
}
`;

test("a Copilot wake resumes the session and enqueues the line", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-copilot-"));
  t.after(() => {
    delete process.env.PAIR_TEST_FAIL;
    return fs.rm(directory, { recursive: true, force: true });
  });
  const log = path.join(directory, "calls.json");
  const sdk = path.join(directory, "index.mjs");
  await fs.writeFile(sdk, sdkSource(log));
  const target = { harness: "copilot", sessionId: "s-1", port: 4321, sdk };
  const line = "pair: the reviewer submitted round 1 of session /s.";
  const calls = [
    [
      "client",
      {
        connection: { kind: "uri", url: "http://127.0.0.1:4321" },
        logLevel: "error",
      },
    ],
    ["start"],
    ["resume", "s-1", true],
    ["send", { prompt: line, mode: "enqueue" }],
    ["stop"],
  ];
  await wakeRunner(target, line);
  assert.deepEqual(JSON.parse(await fs.readFile(log, "utf8")), calls);
  // A failed send still stops the client, which writes the log again, and
  // the wake fails with its error.
  await fs.rm(log);
  process.env.PAIR_TEST_FAIL = "1";
  await assert.rejects(wakeRunner(target, line), /session gone/);
  assert.deepEqual(JSON.parse(await fs.readFile(log, "utf8")), calls);
});
