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
import { exists, killHub, pairCli } from "../support/hub.mjs";

// Without the allow rule, Codex asks the user to approve every pair command.
// pair start therefore refuses to run under Codex until pair setup-codex writes
// the rule.
test("pair start under Codex refuses until the allow rule exists, and pair setup-codex writes it", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-codex-"));
  const rules = path.join(home, "codex-home", "rules", "pair.rules");
  const codex = await pairCli(
    home,
    { CODEX_HOME: path.join(home, "codex-home"), PAIR_HUB_PORT: "0" },
    { harness: "codex" },
  );
  t.after(async () => {
    await killHub(codex.config);
    await fs.rm(home, { recursive: true, force: true });
  });
  await assert.rejects(codex.start(), (error) => {
    assert.equal(error.code, 1);
    for (const part of [rules, "pair setup-codex"])
      assert(error.stderr.includes(part), error.stderr);
    return true;
  });
  assert.equal(await exists(codex.config.sessions), false);
  assert.deepEqual(JSON.parse(await codex.run("setup-codex", "--json")), {
    rules,
    written: true,
  });
  assert.equal(
    await fs.readFile(rules, "utf8"),
    'prefix_rule(pattern=["pair"], decision="allow", justification="pair: the command talks to its local hub and writes the session under the state directory")\n',
  );
  const started = await codex.start();
  assert.deepEqual(started.wake, { harness: "codex" });
  const report = JSON.parse(await codex.run("check", "--json"));
  assert.equal(report.codex.present, true);
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

// The hub wakes a Codex session through the app-server daemon of Codex 0.160.
// When the daemon cannot add the line to a turn in progress, the adapter runs
// codex queue instead. codexDaemon stands in for the daemon, and codexCommand
// stands in for codex.
// On Windows, npm installs Codex as codex.cmd, and the adapter's execFile
// cannot run a .cmd file without a shell, so a Codex wake does not work there
// yet.
const unix = {
  skip: process.platform === "win32" && "a Codex wake needs codex.cmd support",
};
const thread = "thread-1";
// This line copies the hub's wake line for a thread, which contains the
// session's directory and the pair read command that prints the thread. It is
// longer than the 125 bytes of a short WebSocket frame, and it ends with the
// reviewer's message on lines of its own.
const line = `pair: a thread on "Overview", session /s, needs an answer. Answer it between your current steps without dropping your work: run pair read --session-dir /s --thread 6f1c2a9e-5b7d-4e3a-9c2f-8a1b3d4e5f60, which prints the thread and how to answer.\n\nThe reviewer's message, which pair read prints too:\nWhat happens to a failed item?`;
const queued = ["queue", "--thread", thread, "--message", line];

test("a Codex wake steers the turn in progress", unix, async (t) => {
  const codex = await codexCommand(t);
  const daemon = await codexDaemon(t, turnInProgress(thread, "turn-2"));
  const result = await wakeRunner(
    { harness: "codex", thread, socket: daemon.socket },
    line,
  );
  assert.deepEqual(result, { via: "steer", steerable: true });
  const steer = daemon.received.find(({ method }) => method === "turn/steer");
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
    ["thread/queue/add answered with an error", status("idle"), true],
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
  // The hub records the error's message as the reason the wake failed.
  process.env.PAIR_TEST_FAIL = "1";
  await assert.rejects(
    wakeRunner({ harness: "codex", thread, socket: missing }, line),
    /^Error: thread gone$/,
  );
});

// idleQueue answers as the daemon does for an idle thread. Codex starts a line
// that thread/queue/add queues at once, unless the user interrupted the
// thread's last turn. After an interrupt, Codex starts the line only on a
// thread/queue/start request.
function idleQueue({ interrupted, start }) {
  const queue = [];
  return {
    "thread/read": { thread: { id: thread, status: { type: "idle" } } },
    "thread/queue/add": ({ input }) => {
      const queuedSubmission = { id: "queued-1", input };
      if (interrupted) queue.push(queuedSubmission);
      return { queuedSubmission };
    },
    "thread/queue/start": ({ queuedSubmissionId }) => {
      const index = queue.findIndex(({ id }) => id === queuedSubmissionId);
      if (index < 0)
        return {
          error: {
            code: -32600,
            message: `queued submission not found: ${queuedSubmissionId}`,
          },
        };
      if (start) return start;
      queue.splice(index, 1);
      return { turn: { id: "turn-3", status: "inProgress", items: [] } };
    },
    "thread/queue/list": () => ({ data: queue, nextCursor: null }),
  };
}

test(
  "a Codex wake starts a turn with the line it queues on an idle thread",
  unix,
  async (t) => {
    const codex = await codexCommand(t);
    const draining = {
      error: { code: -32600, message: "server is draining" },
    };
    const cases = [
      ["after an interrupted turn", { interrupted: true }],
      ["Codex starts the line itself", { interrupted: false }],
    ];
    for (const [name, options] of cases) {
      const daemon = await codexDaemon(t, idleQueue(options));
      const result = await wakeRunner(
        { harness: "codex", thread, socket: daemon.socket },
        line,
      );
      assert.deepEqual(result, { via: "queue", steerable: true }, name);
      const add = daemon.received.find(
        ({ method }) => method === "thread/queue/add",
      );
      assert.deepEqual(add.params.input, [{ type: "text", text: line }], name);
      const start = daemon.received.find(
        ({ method }) => method === "thread/queue/start",
      );
      assert.deepEqual(
        start.params,
        { threadId: thread, queuedSubmissionId: "queued-1" },
        name,
      );
    }
    assert.deepEqual(await codex.runs(), []);
    // The hub records the error's message as the reason the wake failed.
    const waiting = await codexDaemon(
      t,
      idleQueue({ interrupted: true, start: draining }),
    );
    await assert.rejects(
      wakeRunner({ harness: "codex", thread, socket: waiting.socket }, line),
      /started no turn with it: server is draining$/,
    );
    assert.deepEqual(await codex.runs(), []);
  },
);

// Codex refuses input from another process to a spawned subagent that its
// daemon has not loaded. The adapter therefore sends the hub's line to the
// parent thread with the subagent's ID, and the parent agent passes it on.
test(
  "a Codex wake for a spawned subagent goes to its parent thread",
  unix,
  async (t) => {
    const codex = await codexCommand(t);
    const parent = "thread-parent";
    // Codex 0.160 answers thread/read with this for a subagent that an
    // in-process parent spawned.
    const subagent = {
      id: thread,
      parentThreadId: parent,
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: parent,
            depth: 1,
            agent_path: null,
            agent_nickname: "Dalton",
            agent_role: null,
          },
        },
      },
      agentNickname: "Dalton",
      status: { type: "notLoaded" },
    };
    const daemon = (parentAnswers) =>
      codexDaemon(t, {
        ...parentAnswers,
        "thread/read": ({ threadId }) =>
          threadId === thread
            ? { thread: subagent }
            : parentAnswers["thread/read"],
      });
    const relayed = (text) => {
      assert(text.endsWith(`\n\n${line}`), text);
      for (const part of ["Dalton", `target ${thread}`, "followup_task"])
        assert(text.includes(part), text);
    };

    const steered = await daemon(turnInProgress(parent, "turn-7"));
    const result = await wakeRunner(
      { harness: "codex", thread, socket: steered.socket },
      line,
    );
    assert.deepEqual(result, { via: "parent", steerable: false });
    const steer = steered.received.find(
      ({ method }) => method === "turn/steer",
    );
    assert.equal(steer.params.threadId, parent);
    assert.equal(steer.params.expectedTurnId, "turn-7");
    relayed(steer.params.input[0].text);
    assert.deepEqual(await codex.runs(), []);

    const idle = await daemon({
      "thread/read": { thread: { id: parent, status: { type: "notLoaded" } } },
    });
    assert.deepEqual(
      await wakeRunner({ harness: "codex", thread, socket: idle.socket }, line),
      { via: "parent", steerable: false },
    );
    const [args] = await codex.runs();
    assert.deepEqual(args.slice(0, 4), [
      "queue",
      "--thread",
      parent,
      "--message",
    ]);
    relayed(args[4]);
  },
);
