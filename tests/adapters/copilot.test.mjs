import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { wakeRunner } from "../../src/hub/wake.mjs";

// The hub wakes a Copilot session in a child process, through the SDK that
// ships inside Copilot CLI. This stand-in SDK appends the calls each child
// makes as one line of the log, and refuses a send in each mode that
// PAIR_TEST_REFUSE names.
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
  // Each child connects, resumes the session, sends once and stops, even
  // when the send fails.
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
