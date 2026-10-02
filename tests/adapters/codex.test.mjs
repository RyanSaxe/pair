import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withSandboxHint } from "../../adapters/codex/rules.mjs";
import { wakeRunner } from "../../src/hub/wake.mjs";
import {
  codexCommand,
  codexDaemon,
  turnInProgress,
} from "../support/codex.mjs";
import { exec, pair } from "../support/hub.mjs";

test("the Codex rules allow pair, and check reports Codex's sandbox", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-codex-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const env = {
    ...process.env,
    CODEX_HOME: path.join(home, "codex"),
    XDG_STATE_HOME: path.join(home, "state"),
    PAIR_HUB_PORT: "0",
  };
  await exec(process.execPath, [pair, "check", "--codex-rules"], { env });
  assert.equal(
    await fs.readFile(path.join(home, "codex", "rules", "pair.rules"), "utf8"),
    'prefix_rule(pattern=["pair"], decision="allow", justification="pair: the command talks to its local hub and writes the session under the state directory")\n',
  );
  const probe = path.join(home, "probe");
  await fs.mkdir(probe);
  const { stdout } = await exec(process.execPath, [pair, "check", probe], {
    env: { ...env, CODEX_SANDBOX: "seatbelt" },
  });
  assert.equal(JSON.parse(stdout).codex.present, true);
});

test("the sandbox hint follows a refusal, not the environment alone", () => {
  const env = { CODEX_SANDBOX: "seatbelt" };
  assert.match(
    withSandboxHint("connect EPERM 127.0.0.1:4747", env),
    /outside the sandbox/,
  );
  assert.equal(withSandboxHint("Unknown session", env), "Unknown session");
  assert.equal(
    withSandboxHint("connect EPERM 127.0.0.1:4747", {}),
    "connect EPERM 127.0.0.1:4747",
  );
});

// The hub wakes a Codex session through the daemon of Codex 0.160, and
// through codex queue when the daemon cannot take the line into a turn in
// progress. The fake daemon stands in for the first, and the stand-in codex
// for the second.
// npm installs Codex on Windows as codex.cmd, which the adapter's execFile
// cannot run without a shell, so a Codex wake does not work there yet.
const unix = {
  skip: process.platform === "win32" && "a Codex wake needs codex.cmd support",
};
const thread = "thread-1";
// A side-work line contains the reviewer's message, so a line can pass the
// 125 bytes of a short frame.
const line = `pair: side work "Retry" was started in parallel on session /s. ${"Do it apart from the session's own work. ".repeat(4)}`;
const queued = ["queue", "--thread", thread, "--message", line];

test("a Codex wake steers the turn in progress", unix, async (t) => {
  const codex = await codexCommand(t);
  const daemon = await codexDaemon(t, turnInProgress(thread, "turn-2"));
  const result = await wakeRunner(
    { harness: "codex", thread, socket: daemon.socket },
    line,
  );
  assert.deepEqual(result, { via: "steer", steerable: true });
  assert.deepEqual(
    daemon.received.map((message) => message.method),
    [
      "initialize",
      "initialized",
      "thread/read",
      "thread/turns/list",
      "turn/steer",
    ],
  );
  const [, , , turns, steer] = daemon.received;
  assert.deepEqual(turns.params, {
    threadId: thread,
    limit: 1,
    itemsView: "notLoaded",
  });
  assert.deepEqual(steer.params, {
    threadId: thread,
    expectedTurnId: "turn-2",
    input: [{ type: "text", text: line }],
  });
  assert.deepEqual(await codex.runs(), []);
});

test("a Codex wake falls back to codex queue", unix, async (t) => {
  const codex = await codexCommand(t);
  const missing = path.join(codex.directory, "none.sock");
  const status = (type) => ({
    "thread/read": { thread: { id: thread, status: { type } } },
  });
  const cases = [
    ["no socket", null, false],
    ["status notLoaded", status("notLoaded"), false],
    ["status idle", status("idle"), true],
    [
      "turn/steer answered with an error",
      {
        ...turnInProgress(thread, "turn-2"),
        "turn/steer": { error: { code: -32600, message: "no active turn" } },
      },
      true,
    ],
  ];
  for (const [name, answers, steerable] of cases) {
    const socket = answers ? (await codexDaemon(t, answers)).socket : missing;
    const result = await wakeRunner({ harness: "codex", thread, socket }, line);
    assert.deepEqual(result, { via: "queue", steerable }, name);
    assert.deepEqual((await codex.runs()).at(-1), queued, name);
  }
  assert.equal((await codex.runs()).length, cases.length);
  // The hub records this message as the wake's reason.
  process.env.PAIR_TEST_FAIL = "1";
  await assert.rejects(
    wakeRunner({ harness: "codex", thread, socket: missing }, line),
    /^Error: thread gone$/,
  );
});
